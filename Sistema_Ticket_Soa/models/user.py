from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class User:
    ID: Optional[int]
    Nombre: str
    Email: str
    Password_hash: str
    Roll: str
    Fecha_creacion: datetime
    Estado: str
    Activo: bool
    
    @classmethod
    def create(cls, nombre: str, email: str, password_hash: str, roll: str = "user"):
        return cls(
            ID=None,
            Nombre=nombre,
            Email=email,
            Password_hash=password_hash,
            Roll=roll,
            Fecha_creacion=datetime.now(),
            Estado="activo",
            Activo=True
        )