import logging
from time import perf_counter

from backend.app.domain.inputs import PipelineContext, SourceDocument
from backend.app.domain.models import ExtractionJob, ExtractionJobResponse, PipelineStage, utc_now
from backend.app.ports.agents import PipelineAgent
from backend.app.ports.repositories import JobRepository, NoteRepository

logger = logging.getLogger("eigenscribe.pipeline")


class ExtractionPipeline:
    def __init__(self, agents: list[PipelineAgent], jobs: JobRepository, notes: NoteRepository) -> None:
        self.agents = agents
        self.jobs = jobs
        self.notes = notes

    async def execute(self, source: SourceDocument) -> ExtractionJobResponse:
        started = perf_counter()
        logger.info(
            "Semantic pipeline start | filename=%r content_type=%s bytes=%d agents=%d",
            source.filename,
            source.content_type,
            len(source.content),
            len(self.agents),
        )
        job = await self.jobs.save(
            ExtractionJob(sourceName=source.filename, status="running", currentStage=PipelineStage.INGEST)
        )
        context = PipelineContext(source=source)
        try:
            for agent in self.agents:
                stage_started = perf_counter()
                job.currentStage = agent.stage
                job.updatedAt = utc_now()
                await self.jobs.save(job)
                logger.info("Pipeline stage start | job=%s stage=%s", job.id, agent.stage.value)
                context = await agent.run(context)
                logger.info(
                    "Pipeline stage complete | job=%s stage=%s elapsed=%.2fs blocks=%d reports=%d",
                    job.id,
                    agent.stage.value,
                    perf_counter() - stage_started,
                    len(context.blocks),
                    len(context.reports),
                )
                job.completedStages.append(agent.stage)
            if context.note is None:
                raise RuntimeError("Pipeline completed without a semantic note")
            note = await self.notes.save(context.note)
            job.status = "needs-review"
            job.noteId = note.id
            job.updatedAt = utc_now()
            await self.jobs.save(job)
            logger.info(
                "Semantic pipeline complete | job=%s note=%s blocks=%d elapsed=%.2fs",
                job.id,
                note.id,
                len(note.blocks),
                perf_counter() - started,
            )
            return ExtractionJobResponse(job=job, note=note)
        except Exception as exc:
            logger.exception(
                "Semantic pipeline failed | job=%s stage=%s elapsed=%.2fs",
                job.id,
                job.currentStage,
                perf_counter() - started,
            )
            job.status = "failed"
            job.error = str(exc)
            job.updatedAt = utc_now()
            await self.jobs.save(job)
            return ExtractionJobResponse(job=job)
