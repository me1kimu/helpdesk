from typing import List, Optional, Dict, Any
from database.database import DatabaseManager

class TicketService:
    def __init__(self, db_manager: DatabaseManager, service_bus):
        self.db_manager = db_manager
        self.service_bus = service_bus
        self._register_handlers()
    
    def _register_handlers(self):
        """Registra los manejadores en el bus"""
        self.service_bus.register_handler("tickets", "create", self._handle_create_ticket)
        self.service_bus.register_handler("tickets", "get_by_user", self._handle_get_tickets_by_user)
        self.service_bus.register_handler("tickets", "get_all", self._handle_get_all_tickets)
        self.service_bus.register_handler("tickets", "add_comment", self._handle_add_comment)
        self.service_bus.register_handler("tickets", "get_comments", self._handle_get_comments)
        self.service_bus.register_handler("tickets", "update_status", self._handle_update_status)
        self.service_bus.register_handler("tickets", "get_by_status", self._handle_get_tickets_by_status)
        self.service_bus.register_handler("tickets", "get_tecnico_tickets", self._handle_get_tecnico_tickets)
    
    def _handle_create_ticket(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Maneja la creación de tickets"""
        try:
            titulo = payload['titulo']
            categoria_id = payload['categoria_id']
            solicitante_id = payload['solicitante_id']
            descripcion = payload.get('descripcion', '')
            prioridad = payload.get('prioridad', 'media')
            
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO Ticket 
                (Titulo, Categoria_ID, Prioridad, Estado, Solicitante_ID)
                VALUES (?, ?, ?, ?, ?)
            ''', (titulo, categoria_id, prioridad, 'abierto', solicitante_id))
            
            ticket_id = cursor.lastrowid
            
            if descripcion:
                cursor.execute('''
                    INSERT INTO Comentarios (Contenido, Ticket_ID, Usuario_ID)
                    VALUES (?, ?, ?)
                ''', (descripcion, ticket_id, solicitante_id))
            
            conn.commit()
            conn.close()
            
            return {"success": True, "ticket_id": ticket_id}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _handle_get_tickets_by_user(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Obtiene tickets por usuario"""
        user_id = payload['user_id']
        
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT t.*, c.Nombre as CategoriaNombre
            FROM Ticket t
            LEFT JOIN Categorias c ON t.Categoria_ID = c.ID
            WHERE t.Solicitante_ID = ?
            ORDER BY t.Fecha_creacion DESC
        ''', (user_id,))
        
        tickets_data = cursor.fetchall()
        conn.close()
        
        tickets = []
        for ticket_data in tickets_data:
            tickets.append(dict(ticket_data))
        
        return tickets
    
    def _handle_get_all_tickets(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Obtiene todos los tickets"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT t.*, c.Nombre as CategoriaNombre, u.Nombre as SolicitanteNombre
            FROM Ticket t
            LEFT JOIN Categorias c ON t.Categoria_ID = c.ID
            LEFT JOIN Usuarios u ON t.Solicitante_ID = u.ID
            ORDER BY t.Fecha_creacion DESC
        ''')
        
        tickets_data = cursor.fetchall()
        conn.close()
        
        tickets = []
        for ticket_data in tickets_data:
            tickets.append(dict(ticket_data))
        
        return tickets
    
    def _handle_add_comment(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Añade un comentario a un ticket"""
        try:
            ticket_id = payload['ticket_id']
            usuario_id = payload['usuario_id']
            contenido = payload['contenido']
            
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO Comentarios (Contenido, Ticket_ID, Usuario_ID)
                VALUES (?, ?, ?)
            ''', (contenido, ticket_id, usuario_id))
            
            conn.commit()
            conn.close()
            
            return {"success": True}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _handle_get_comments(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Obtiene comentarios por ticket o por usuario"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        # Si se proporciona nombre de usuario, buscar por usuario
        if 'usuario_nombre' in payload:
            usuario_nombre = payload['usuario_nombre']
            cursor.execute('''
                SELECT c.*, u.Nombre as UsuarioNombre, t.Titulo as TicketTitulo
                FROM Comentarios c
                LEFT JOIN Usuarios u ON c.Usuario_ID = u.ID
                LEFT JOIN Ticket t ON c.Ticket_ID = t.ID
                WHERE u.Nombre = ?
                ORDER BY c.Fecha_creacion ASC
            ''', (usuario_nombre,))
        # Si no, buscar por ticket (comportamiento original)
        elif 'ticket_id' in payload:
            ticket_id = payload['ticket_id']
            cursor.execute('''
                SELECT c.*, u.Nombre as UsuarioNombre
                FROM Comentarios c
                LEFT JOIN Usuarios u ON c.Usuario_ID = u.ID
                WHERE c.Ticket_ID = ?
                ORDER BY c.Fecha_creacion ASC
            ''', (ticket_id,))
        else:
            conn.close()
            return []
        
        comments_data = cursor.fetchall()
        conn.close()
        
        comments = []
        for comment_data in comments_data:
            comments.append(dict(comment_data))
        
        return comments
    
    def _handle_update_status(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Actualiza el estado de un ticket"""
        try:
            ticket_id = payload['ticket_id']
            nuevo_estado = payload['nuevo_estado']
            tecnico_id = payload.get('tecnico_id')
            
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            if nuevo_estado.lower() in ['cerrado', 'resuelto', 'completado']:
                cursor.execute('''
                    UPDATE Ticket 
                    SET Estado = ?, Ejecutivo_ID = ?, Fecha_cierre = CURRENT_TIMESTAMP
                    WHERE ID = ?
                ''', (nuevo_estado, tecnico_id, ticket_id))
            else:
                cursor.execute('''
                    UPDATE Ticket 
                    SET Estado = ?, Ejecutivo_ID = ?
                    WHERE ID = ?
                ''', (nuevo_estado, tecnico_id, ticket_id))
            
            conn.commit()
            conn.close()
            return {"success": True}
            
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _handle_get_tickets_by_status(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Obtiene tickets por estado"""
        estado = payload['estado']
        
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT t.*, c.Nombre as CategoriaNombre, u.Nombre as SolicitanteNombre
            FROM Ticket t
            LEFT JOIN Categorias c ON t.Categoria_ID = c.ID
            LEFT JOIN Usuarios u ON t.Solicitante_ID = u.ID
            WHERE t.Estado = ?
            ORDER BY t.Fecha_creacion DESC
        ''', (estado,))
        
        tickets_data = cursor.fetchall()
        conn.close()
        
        return [dict(ticket) for ticket in tickets_data]

    def _handle_get_tecnico_tickets(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Obtiene tickets asignados a un técnico"""
        tecnico_id = payload['tecnico_id']
        
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT t.*, c.Nombre as CategoriaNombre, u.Nombre as SolicitanteNombre
            FROM Ticket t
            LEFT JOIN Categorias c ON t.Categoria_ID = c.ID
            LEFT JOIN Usuarios u ON t.Solicitante_ID = u.ID
            WHERE t.Ejecutivo_ID = ?
            ORDER BY t.Fecha_creacion DESC
        ''', (tecnico_id,))
        
        tickets_data = cursor.fetchall()
        conn.close()
        
        return [dict(ticket) for ticket in tickets_data]
    
    # Métodos de conveniencia para compatibilidad
    def create_ticket(self, titulo: str, categoria_id: int, solicitante_id: int, 
                     descripcion: str = "", prioridad: str = "media") -> bool:
        """Método de conveniencia para crear ticket"""
        result = self.service_bus.send_command("tickets", "create", {
            "titulo": titulo,
            "categoria_id": categoria_id,
            "solicitante_id": solicitante_id,
            "descripcion": descripcion,
            "prioridad": prioridad
        })
        return result.response["success"] if result.response else False
    
    def get_tickets_by_user(self, user_id: int) -> List[Dict[str, Any]]:
        """Método de conveniencia para obtener tickets por usuario"""
        return self.service_bus.send_query("tickets", "get_by_user", {
            "user_id": user_id
        })
    
    def get_all_tickets(self) -> List[Dict[str, Any]]:
        """Método de conveniencia para obtener todos los tickets"""
        return self.service_bus.send_query("tickets", "get_all", {})
    
    def add_comment(self, ticket_id: int, usuario_id: int, contenido: str) -> bool:
        """Método de conveniencia para añadir comentario"""
        result = self.service_bus.send_command("tickets", "add_comment", {
            "ticket_id": ticket_id,
            "usuario_id": usuario_id,
            "contenido": contenido
        })
        return result.response["success"] if result.response else False
    
    def get_comments_by_ticket(self, ticket_id: int) -> List[Dict[str, Any]]:
        """Método de conveniencia para obtener comentarios por ticket"""
        return self.service_bus.send_query("tickets", "get_comments", {
            "ticket_id": ticket_id
        })

    def update_ticket_status(self, ticket_id: int, nuevo_estado: str, tecnico_id: int = None) -> bool:
        """Método de conveniencia para actualizar estado del ticket"""
        result = self.service_bus.send_command("tickets", "update_status", {
            "ticket_id": ticket_id,
            "nuevo_estado": nuevo_estado,
            "tecnico_id": tecnico_id
        })
        return result.response["success"] if result.response else False

    def get_tickets_by_status(self, estado: str) -> List[Dict[str, Any]]:
        """Método de conveniencia para obtener tickets por estado"""
        return self.service_bus.send_query("tickets", "get_by_status", {
            "estado": estado
        })

    def get_tecnico_tickets(self, tecnico_id: int) -> List[Dict[str, Any]]:
        """Método de conveniencia para obtener tickets de técnico"""
        return self.service_bus.send_query("tickets", "get_tecnico_tickets", {
            "tecnico_id": tecnico_id
        })

    def get_comments_by_user(self, usuario_nombre: str) -> List[Dict[str, Any]]:
        """Método de conveniencia para obtener comentarios por usuario"""
        return self.service_bus.send_query("tickets", "get_comments", {
            "usuario_nombre": usuario_nombre
        })