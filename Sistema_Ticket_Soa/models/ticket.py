from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class Ticket:
    ID: Optional[int]
    Titulo: str
    Categoria_ID: int
    Prioridad: str
    Estado: str
    Fecha_creacion: datetime
    Fecha_cierre: Optional[datetime]
    Solicitante_ID: int
    Ejecutivo_ID: Optional[int]
    
    @classmethod
    def create(cls, titulo: str, categoria_id: int, solicitante_id: int, 
               prioridad: str = "media"):
        return cls(
            ID=None,
            Titulo=titulo,
            Categoria_ID=categoria_id,
            Prioridad=prioridad,
            Estado="abierto",
            Fecha_creacion=datetime.now(),
            Fecha_cierre=None,
            Solicitante_ID=solicitante_id,
            Ejecutivo_ID=None
        )