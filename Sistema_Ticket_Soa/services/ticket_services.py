from typing import List, Optional
from datetime import datetime
from database.database import DatabaseManager
from models.ticket import Ticket
from models.comment import Comment

class TicketService:
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager
    
    def create_ticket(self, ticket: Ticket, initial_comment: str = None) -> Optional[int]:
        """Crea un nuevo ticket"""
        try:
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO Ticket 
                (Titulo, Categoria_ID, Prioridad, Estado, Solicitante_ID)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                ticket.Titulo,
                ticket.Categoria_ID,
                ticket.Prioridad,
                ticket.Estado,
                ticket.Solicitante_ID
            ))
            
            ticket_id = cursor.lastrowid
            
            # Crear comentario inicial si se proporciona
            if initial_comment:
                cursor.execute('''
                    INSERT INTO Comentarios (Contenido, Ticket_ID, Usuario_ID)
                    VALUES (?, ?, ?)
                ''', (initial_comment, ticket_id, ticket.Solicitante_ID))
            
            conn.commit()
            conn.close()
            return ticket_id
        except Exception as e:
            print(f"Error creando ticket: {e}")
            return None
    
    def get_tickets_by_user(self, user_id: int) -> List[Ticket]:
        """Obtiene tickets por usuario"""
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
            tickets.append(Ticket(
                ID=ticket_data['ID'],
                Titulo=ticket_data['Titulo'],
                Categoria_ID=ticket_data['Categoria_ID'],
                Prioridad=ticket_data['Prioridad'],
                Estado=ticket_data['Estado'],
                Fecha_creacion=ticket_data['Fecha_creacion'],
                Fecha_cierre=ticket_data['Fecha_cierre'],
                Solicitante_ID=ticket_data['Solicitante_ID'],
                Ejecutivo_ID=ticket_data['Ejecutivo_ID']
            ))
        
        return tickets
    
    def get_all_tickets(self) -> List[Ticket]:
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
            tickets.append(Ticket(
                ID=ticket_data['ID'],
                Titulo=ticket_data['Titulo'],
                Categoria_ID=ticket_data['Categoria_ID'],
                Prioridad=ticket_data['Prioridad'],
                Estado=ticket_data['Estado'],
                Fecha_creacion=ticket_data['Fecha_creacion'],
                Fecha_cierre=ticket_data['Fecha_cierre'],
                Solicitante_ID=ticket_data['Solicitante_ID'],
                Ejecutivo_ID=ticket_data['Ejecutivo_ID']
            ))
        
        return tickets
    
    def add_comment(self, comment: Comment) -> bool:
        """Añade un comentario a un ticket"""
        try:
            conn = self.db_manager._get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO Comentarios (Contenido, Ticket_ID, Usuario_ID)
                VALUES (?, ?, ?)
            ''', (comment.Contenido, comment.Ticket_ID, comment.Usuario_ID))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"Error añadiendo comentario: {e}")
            return False
    
    def get_comments_by_ticket(self, ticket_id: int) -> List[Comment]:
        """Obtiene comentarios por ticket"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT c.*, u.Nombre as UsuarioNombre
            FROM Comentarios c
            LEFT JOIN Usuarios u ON c.Usuario_ID = u.ID
            WHERE c.Ticket_ID = ?
            ORDER BY c.Fecha_creacion ASC
        ''', (ticket_id,))
        
        comments_data = cursor.fetchall()
        conn.close()
        
        comments = []
        for comment_data in comments_data:
            comments.append(Comment(
                ID=comment_data['ID'],
                Contenido=comment_data['Contenido'],
                Fecha_creacion=comment_data['Fecha_creacion'],
                Ticket_ID=comment_data['Ticket_ID'],
                Usuario_ID=comment_data['Usuario_ID']
            ))
        
        return comments