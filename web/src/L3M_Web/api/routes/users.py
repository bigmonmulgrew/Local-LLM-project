from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from L3M_Web.api.dependencies import DatabaseSessionDependency
from L3M_Web.api.models.chat import ResolveUserRequest, User
from L3M_Web.database.chat_repository import ChatRepository

router = APIRouter(prefix="/api/users", tags=["users"])

@router.post("/resolve", response_model=User)
async def resolve_user(payload: ResolveUserRequest, session: DatabaseSessionDependency) -> User:
    username = payload.username.strip()
    if not username:
        raise HTTPException( status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="username cannot be blank" )
    return await ChatRepository(session).resolve_user(username)