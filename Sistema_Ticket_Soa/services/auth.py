from typing import Optional, Dict, Any
from database.database import DatabaseManager
from models.user import User

class AuthService:
    def __init__(self, db_manager: DatabaseManager, service_bus):
        self.db_manager = db_manager
        self.service_bus = service_bus
        self.current_user: Optional[User] = None
        self._register_handlers()
    
    def _register_handlers(self):
        """Registra los manejadores en el bus"""
        self.service_bus.register_handler("auth", "authenticate", self._handle_authenticate)
        self.service_bus.register_handler("auth", "get_current_user", self._handle_get_current_user)
        self.service_bus.register_handler("auth", "logout", self._handle_logout)
    
    def _handle_authenticate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Maneja la autenticación de usuarios"""
        username = payload.get('username')
        password = payload.get('password')
        
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM Usuarios WHERE Nombre = ? AND Activo = 1',
            (username,)
        )
        
        user_data = cursor.fetchone()
        conn.close()
        
        if not user_data:
            return {"success": False, "error": "Usuario no encontrado"}
        
        if self.db_manager.verify_password(password, user_data['Password_hash']):
            user_password_hash = user_data['Password_hash']
            if isinstance(user_data['Password_hash'], str) and '$' not in user_data['Password_hash'] and isinstance(password, str):
                user_password_hash = self.db_manager.hash_password(password)
                conn = self.db_manager._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    'UPDATE Usuarios SET Password_hash = ? WHERE ID = ?',
                    (user_password_hash, user_data['ID'])
                )
                conn.commit()
                conn.close()

            self.current_user = User(
                ID=user_data['ID'],
                Nombre=user_data['Nombre'],
                Email=user_data['Email'],
                Password_hash=user_password_hash,
                Roll=user_data['Roll'],
                Fecha_creacion=user_data['Fecha_creacion'],
                Estado=user_data['Estado'],
                Activo=bool(user_data['Activo'])
            )
            
            # Publicar evento de login exitoso
            self.service_bus.publish_event("auth", "user_logged_in", {
                "user_id": self.current_user.ID,
                "username": self.current_user.Nombre
            })
            
            return {"success": True, "user": self.current_user.Nombre}
        
        return {"success": False, "error": "Contraseña incorrecta"}
    
    def _handle_get_current_user(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Retorna el usuario actual"""
        if self.current_user:
            return {
                "id": self.current_user.ID,
                "nombre": self.current_user.Nombre,
                "email": self.current_user.Email,
                "roll": self.current_user.Roll
            }
        return None
    
    def _handle_logout(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Maneja el cierre de sesión"""
        if self.current_user:
            username = self.current_user.Nombre
            self.current_user = None
            
            # Publicar evento de logout
            self.service_bus.publish_event("auth", "user_logged_out", {
                "username": username
            })
            
            return {"success": True, "message": f"Sesión cerrada para {username}"}
        
        return {"success": False, "error": "No hay sesión activa"}
    
    # Métodos de conveniencia para compatibilidad
    def authenticate(self, username: str, password: str) -> bool:
        """Método de conveniencia para autenticación"""
        result = self.service_bus.send_command("auth", "authenticate", {
            "username": username,
            "password": password
        })
        return result.response["success"] if result.response else False
    
    def get_current_user(self) -> Optional[User]:
        """Método de conveniencia para obtener usuario actual"""
        return self.current_user
    
    def is_authenticated(self) -> bool:
        return self.current_user is not None
    
    def has_role(self, role: str) -> bool:
        return self.is_authenticated() and self.current_user.Roll == role
    
    def logout(self):
        """Método de conveniencia para logout"""
        self.service_bus.send_command("auth", "logout", {})