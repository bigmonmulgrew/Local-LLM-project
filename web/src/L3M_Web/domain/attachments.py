"""Domain records shared by attachment storage and chat persistence."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True, slots=True)
class StoredAttachment:
    """Metadata for one attachment whose bytes are in persistent storage."""

    id: str
    name: str
    stored_name: str
    content_type: str
    size: int
    sha256: str
    storage_path: str


@dataclass(frozen=True, slots=True)
class ConversationMessage:
    """Internal message representation used to build an Ollama request."""

    role: Literal["user", "assistant"]
    content: str
    attachments: tuple[StoredAttachment, ...] = field(default_factory=tuple)