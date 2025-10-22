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
    
    def is_tecnico(self) -> bool:
        return self.Roll.lower() in ['tecnico', 'admin', 'technician', 'administrador']
    
    def is_usuario(self) -> bool:
        return self.Roll.lower() in ['user', 'usuario', 'user']
    
    def can_manage_tickets(self) -> bool:
        """Determina si el usuario puede gestionar tickets (técnicos)"""
        return self.is_tecnico()
    
    def __repr__(self):
        return f"User(ID={self.ID}, Nombre='{self.Nombre}', Roll='{self.Roll}')"