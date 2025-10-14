from typing import Optional, Dict, Any
from database.database import DatabaseManager
from models.user import User

class AuthService:
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager
        self.current_user: Optional[User] = None
    
    def authenticate(self, username: str, password: str) -> bool:
        """Autentica un usuario"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM Usuarios WHERE Nombre = ? AND Activo = 1',
            (username,)
        )
        
        user_data = cursor.fetchone()
        conn.close()
        
        if not user_data:
            return False
        
        hashed_input = self.db_manager.hash_password(password)
        if user_data['Password_hash'] == hashed_input:
            self.current_user = User(
                ID=user_data['ID'],
                Nombre=user_data['Nombre'],
                Email=user_data['Email'],
                Password_hash=user_data['Password_hash'],
                Roll=user_data['Roll'],
                Fecha_creacion=user_data['Fecha_creacion'],
                Estado=user_data['Estado'],
                Activo=bool(user_data['Activo'])
            )
            return True
        
        return False
    
    def logout(self):
        """Cierra la sesión actual"""
        self.current_user = None
    
    def get_current_user(self) -> Optional[User]:
        """Obtiene el usuario actual"""
        return self.current_user
    
    def is_authenticated(self) -> bool:
        """Verifica si hay una sesión activa"""
        return self.current_user is not None
    
    def has_role(self, role: str) -> bool:
        """Verifica si el usuario actual tiene un rol específico"""
        return self.is_authenticated() and self.current_user.Roll == role