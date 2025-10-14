from typing import List, Optional
from database.database import DatabaseManager
from models.user import User

class UserService:
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager
    
    def create_user(self, user: User) -> bool:
        """Crea un nuevo usuario"""
        try:
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO Usuarios 
                (Nombre, Email, Password_hash, Roll, Estado, Activo)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                user.Nombre, 
                user.Email, 
                user.Password_hash, 
                user.Roll, 
                user.Estado, 
                user.Activo
            ))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"Error creando usuario: {e}")
            return False
    
    def get_user_by_username(self, username: str) -> Optional[User]:
        """Obtiene un usuario por nombre de usuario"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM Usuarios WHERE Nombre = ? AND Activo = 1',
            (username,)
        )
        
        user_data = cursor.fetchone()
        conn.close()
        
        if user_data:
            return User(
                ID=user_data['ID'],
                Nombre=user_data['Nombre'],
                Email=user_data['Email'],
                Password_hash=user_data['Password_hash'],
                Roll=user_data['Roll'],
                Fecha_creacion=user_data['Fecha_creacion'],
                Estado=user_data['Estado'],
                Activo=bool(user_data['Activo'])
            )
        return None
    
    def change_password(self, user_id: int, new_password_hash: str) -> bool:
        """Cambia la contraseña de un usuario"""
        try:
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                UPDATE Usuarios 
                SET Password_hash = ? 
                WHERE ID = ?
            ''', (new_password_hash, user_id))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"Error cambiando contraseña: {e}")
            return False