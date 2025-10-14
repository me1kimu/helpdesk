from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class Comment:
    ID: Optional[int]
    Contenido: str
    Fecha_creacion: datetime
    Ticket_ID: int
    Usuario_ID: int
    
    @classmethod
    def create(cls, contenido: str, ticket_id: int, usuario_id: int):
        return cls(
            ID=None,
            Contenido=contenido,
            Fecha_creacion=datetime.now(),
            Ticket_ID=ticket_id,
            Usuario_ID=usuario_id
        )