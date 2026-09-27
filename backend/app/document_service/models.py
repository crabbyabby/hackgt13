from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Interpretation(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    reading: str = Field(min_length=1, max_length=30000)
    latex: str = Field(default='', max_length=30000)
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(default='', max_length=3000)


class SourceRegion(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)


class Block(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str = Field(min_length=1, max_length=100)
    type: Literal['heading', 'paragraph', 'equation', 'graph', 'diagram']
    page: int = Field(ge=1)
    sourceRegion: SourceRegion | None = None
    text: str = Field(default='', max_length=30000)
    latex: str = Field(default='', max_length=30000)
    description: str = Field(default='', max_length=30000)
    spokenText: str = Field(min_length=1, max_length=30000)
    needsReview: bool
    reviewReason: str = Field(default='', max_length=3000)
    confidence: float = Field(default=0, ge=0, le=1)
    interpretations: list[Interpretation] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def check_content(self):
        field = {
            'heading': 'text',
            'paragraph': 'text',
            'equation': 'latex',
            'graph': 'description',
            'diagram': 'description',
        }[self.type]
        if not getattr(self, field).strip() or not self.spokenText.strip():
            raise ValueError('Block content and narration cannot be blank.')
        if self.needsReview and not self.reviewReason.strip():
            raise ValueError('Provide a reason when needsReview is true.')
        return self


class ExtractedDocument(BaseModel):
    # Accept Person 1's full document envelope, but only trust title and blocks.
    # Backend owns id, status, revision, pages, and timestamps.
    model_config = ConfigDict(extra='ignore', strict=True)
    title: str = Field(min_length=1, max_length=300)
    blocks: list[Block] = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def unique_ids(self):
        if not self.title.strip():
            raise ValueError('Title cannot be blank.')
        if len({b.id for b in self.blocks}) != len(self.blocks):
            raise ValueError('Block IDs must be unique.')
        return self


class EditDocument(ExtractedDocument):
    model_config = ConfigDict(extra='forbid', strict=True)
    expectedRevision: int = Field(ge=1)


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    expectedRevision: int = Field(ge=1)
