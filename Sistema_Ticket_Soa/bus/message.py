from dataclasses import dataclass
from typing import Any, Dict, Optional
from enum import Enum
import uuid
from datetime import datetime

class MessageType(Enum):
    COMMAND = "command"
    QUERY = "query"
    EVENT = "event"

class MessageStatus(Enum):
    PENDING = "pending"
    PROCESSED = "processed"
    FAILED = "failed"

@dataclass
class Message:
    message_id: str
    message_type: MessageType
    service: str
    action: str
    payload: Dict[str, Any]
    timestamp: datetime
    status: MessageStatus = MessageStatus.PENDING
    response: Optional[Any] = None
    error: Optional[str] = None
    
    @classmethod
    def create(cls, message_type: MessageType, service: str, action: str, payload: Dict[str, Any]):
        return cls(
            message_id=str(uuid.uuid4()),
            message_type=message_type,
            service=service,
            action=action,
            payload=payload,
            timestamp=datetime.now()
        )