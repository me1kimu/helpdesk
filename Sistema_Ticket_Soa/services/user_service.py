from typing import List, Optional, Dict, Any
from database.database import DatabaseManager
from models.user import User

class UserService:
    def __init__(self, db_manager: DatabaseManager, service_bus):
        self.db_manager = db_manager
        self.service_bus = service_bus
        self._register_handlers()
    
    def _register_handlers(self):
        """Registra los manejadores en el bus"""
        self.service_bus.register_handler("users", "create", self._handle_create_user)
        self.service_bus.register_handler("users", "get_by_username", self._handle_get_user_by_username)
        self.service_bus.register_handler("users", "change_password", self._handle_change_password)
    
    def _handle_create_user(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Maneja la creación de usuarios"""
        try:
            nombre = payload['nombre']
            email = payload['email']
            password = payload['password']
            roll = payload.get('roll', 'user')
            
            # Verificar si el usuario ya existe
            existing_user = self._handle_get_user_by_username({"username": nombre})
            if existing_user:
                return {"success": False, "error": "El usuario ya existe"}
            
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            password_hash = self.db_manager.hash_password(password)
            
            cursor.execute('''
                INSERT INTO Usuarios 
                (Nombre, Email, Password_hash, Roll, Estado, Activo)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (nombre, email, password_hash, roll, 'activo', 1))
            
            conn.commit()
            conn.close()
            
            # Publicar evento de usuario creado
            self.service_bus.publish_event("users", "user_created", {
                "username": nombre,
                "email": email,
                "roll": roll
            })
            
            return {"success": True, "message": "Usuario creado exitosamente"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _handle_get_user_by_username(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Obtiene un usuario por nombre de usuario"""
        username = payload['username']
        
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM Usuarios WHERE Nombre = ? AND Activo = 1',
            (username,)
        )
        
        user_data = cursor.fetchone()
        conn.close()
        
        if user_data:
            return {
                "id": user_data['ID'],
                "nombre": user_data['Nombre'],
                "email": user_data['Email'],
                "roll": user_data['Roll']
            }
        return None
    
    def _handle_change_password(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Cambia la contraseña de un usuario"""
        try:
            user_id = payload['user_id']
            new_password_hash = payload['new_password_hash']
            
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                UPDATE Usuarios 
                SET Password_hash = ? 
                WHERE ID = ?
            ''', (new_password_hash, user_id))
            
            conn.commit()
            conn.close()
            
            return {"success": True, "message": "Contraseña cambiada exitosamente"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # Métodos de conveniencia para compatibilidad
    def create_user_from_data(self, nombre: str, email: str, password: str, roll: str = "user") -> bool:
        """Método de conveniencia para crear usuario"""
        result = self.service_bus.send_command("users", "create", {
            "nombre": nombre,
            "email": email,
            "password": password,
            "roll": roll
        })
        return result.response["success"] if result.response else False
    
    def get_user_by_username(self, username: str) -> Optional[User]:
        """Método de conveniencia para obtener usuario"""
        result = self.service_bus.send_query("users", "get_by_username", {
            "username": username
        })
        
        if result:
            # Convertir de dict a User object para compatibilidad
            return User(
                ID=result["id"],
                Nombre=result["nombre"],
                Email=result["email"],
                Password_hash="",  # No retornamos el hash por seguridad
                Roll=result["roll"],
                Fecha_creacion=None,  # No disponible en la respuesta
                Estado="activo",
                Activo=True
            )
        return None
    
    def change_password(self, user_id: int, new_password_hash: str) -> bool:
        """Método de conveniencia para cambiar contraseña"""
        result = self.service_bus.send_command("users", "change_password", {
            "user_id": user_id,
            "new_password_hash": new_password_hash
        })
        return result.response["success"] if result.response else False