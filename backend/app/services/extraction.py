from backend.app.domain.inputs import PipelineContext, SourceDocument
from backend.app.domain.models import ExtractionJob, ExtractionJobResponse, PipelineStage, utc_now
from backend.app.ports.agents import PipelineAgent
from backend.app.ports.repositories import JobRepository, NoteRepository


class ExtractionPipeline:
    def __init__(self, agents: list[PipelineAgent], jobs: JobRepository, notes: NoteRepository) -> None:
        self.agents = agents
        self.jobs = jobs
        self.notes = notes

    async def execute(self, source: SourceDocument) -> ExtractionJobResponse:
        job = await self.jobs.save(
            ExtractionJob(sourceName=source.filename, status="running", currentStage=PipelineStage.INGEST)
        )
        context = PipelineContext(source=source)
        try:
            for agent in self.agents:
                job.currentStage = agent.stage
                job.updatedAt = utc_now()
                await self.jobs.save(job)
                context = await agent.run(context)
                job.completedStages.append(agent.stage)
            if context.note is None:
                raise RuntimeError("Pipeline completed without a semantic note")
            note = await self.notes.save(context.note)
            job.status = "needs-review"
            job.noteId = note.id
            job.updatedAt = utc_now()
            await self.jobs.save(job)
            return ExtractionJobResponse(job=job, note=note)
        except Exception as exc:  # noqa: BLE001 - pipeline boundary records adapter failures on the job
            job.status = "failed"
            job.error = str(exc)
            job.updatedAt = utc_now()
            await self.jobs.save(job)
            return ExtractionJobResponse(job=job)
