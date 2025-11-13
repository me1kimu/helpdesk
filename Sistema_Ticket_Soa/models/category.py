from dataclasses import dataclass
from typing import Optional

@dataclass
class Category:
    ID: Optional[int]
    Nombre: str
    Descripcion: Optional[str]
    
    @classmethod
    def create(cls, nombre: str, descripcion: str = None):
        return cls(
            ID=None,
            Nombre=nombre,
            Descripcion=descripcion
        )
        