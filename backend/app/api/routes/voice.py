from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/voice", tags=["voice"])


@router.post("/sessions")
async def create_voice_session():
    # TODO(voice): Resolve the requested note, authorize access, then call VoiceSessionService.
    raise HTTPException(
        status_code=501,
        detail={
            "message": "Realtime voice adapter is not implemented.",
            "todo": [
                "Create ephemeral client secret",
                "Attach navigation tools",
                "Connect browser with WebRTC",
            ],
        },
    )
