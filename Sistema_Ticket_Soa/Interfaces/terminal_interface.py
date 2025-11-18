import os
import getpass
from typing import Optional
from services.auth import AuthService
from services.user_service import UserService
from services.ticket_services import TicketService
from services.category_service import CategoryService

class TerminalInterface:
    def __init__(self, auth_service: AuthService, user_service: UserService,
                 ticket_service: TicketService, category_service: CategoryService):
        self.auth_service = auth_service
        self.user_service = user_service
        self.ticket_service = ticket_service
        self.category_service = category_service
    
    def clear_screen(self):
        """Limpia la pantalla"""
        os.system('cls' if os.name == 'nt' else 'clear')
    
    def show_main_menu(self):
        """Muestra el menú principal"""
        print("\n" + "="*50)
        print("       SISTEMA DE TICKETS - MENÚ PRINCIPAL")
        print("="*50)
        print("1. Iniciar Sesión")
        print("2. Registrarse")
        print("3. Salir")
        print("="*50)
    
    def show_user_menu(self):
        """Muestra el menú de usuario"""
        user = self.auth_service.get_current_user()
        print(f"\n" + "="*50)
        print(f"   Bienvenido: {user.Nombre} ({user.Roll})")
        print("="*50)
        print("1. Crear Ticket")
        print("2. Ver Mis Tickets")
        print("3. Ver Comentarios de Ticket")
        print("4. Agregar Comentario")
        print("5. Cambiar Contraseña")
        if user.Roll == 'admin':
            print("6. Ver Todos los Tickets")
            print("7. Cerrar Ticket")
        print("0. Cerrar Sesión")
        print("="*50)
    
    def handle_registration(self):
        """Maneja el registro de usuarios"""
        print("\n=== REGISTRO DE USUARIO ===")
        
        nombre = input("Nombre de usuario: ").strip()
        if not nombre:
            print("❌ El nombre de usuario no puede estar vacío.")
            return False
        
        if self.user_service.get_user_by_username(nombre):
            print("❌ El usuario ya existe.")
            return False
        
        email = input("Email: ").strip()

        roll =input("Rol del usuario: ").strip()
        if not roll:
            print ("❌ El rol que selecciono no existe.")
            return False
        
        password = getpass.getpass("Contraseña: ")
        if len(password) < 4:
            print("❌ La contraseña debe tener al menos 4 caracteres.")
            return False
        
        confirm_password = getpass.getpass("Confirmar contraseña: ")
        if password != confirm_password:
            print("❌ Las contraseñas no coinciden.")
            return False
        
        # === CAMBIO CORREGIDO ===
        if self.user_service.create_user_from_data(nombre, email, password):
            print("✅ Usuario registrado exitosamente.")
            return True
        else:
            print("❌ Error al registrar el usuario.")
            return False
    
    def handle_login(self):
        """Maneja el inicio de sesión"""
        print("\n=== INICIO DE SESIÓN ===")
        
        username = input("Usuario: ").strip()
        password = getpass.getpass("Contraseña: ")
        
        if self.auth_service.authenticate(username, password):
            print(f"✅ Bienvenido, {username}!")
            return True
        else:
            print("❌ Usuario o contraseña incorrectos.")
            return False
    
    def handle_create_ticket(self):
        """Maneja la creación de tickets"""
        print("\n=== CREAR NUEVO TICKET ===")
        
        titulo = input("Título del ticket: ").strip()
        if not titulo:
            print("❌ El título no puede estar vacío.")
            return
        
        # Mostrar categorías
        categories = self.category_service.get_all_categories()
        print("\n=== CATEGORÍAS DISPONIBLES ===")
        for cat in categories:
            print(f"{cat['ID']}. {cat['Nombre']} - {cat.get('Descripcion', '')}")
        
        try:
            categoria_id = int(input("\nSelecciona el ID de la categoría: "))
            if not any(cat['ID'] == categoria_id for cat in categories):
                print("❌ Categoría no válida.")
                return
        except ValueError:
            print("❌ ID de categoría debe ser un número.")
            return
        
        descripcion = input("Descripción del problema: ").strip()
        
        # Prioridad
        print("\nPrioridades disponibles:")
        print("1. Baja")
        print("2. Media")
        print("3. Alta")
        print("4. Crítica")
        
        prioridades = {1: 'baja', 2: 'media', 3: 'alta', 4: 'critica'}
        try:
            prioridad_opt = int(input("Selecciona prioridad (1-4): "))
            prioridad = prioridades.get(prioridad_opt, 'media')
        except ValueError:
            prioridad = 'media'
        
        user = self.auth_service.get_current_user()
        
        # Usar la versión simplificada que recibe parámetros directamente
        if self.ticket_service.create_ticket(titulo, categoria_id, user.ID, descripcion, prioridad):
            print("✅ Ticket creado exitosamente.")
        else:
            print("❌ Error al crear el ticket.")
    
    def handle_view_my_tickets(self):
        """Muestra los tickets del usuario actual"""
        user = self.auth_service.get_current_user()
        tickets = self.ticket_service.get_tickets_by_user(user.ID)
        
        print(f"\n=== MIS TICKETS ({len(tickets)}) ===")
        if not tickets:
            print("No tienes tickets creados.")
            return
        
        for ticket in tickets:
            print(f"\n📋 Ticket #{ticket['ID']}")
            print(f"   Título: {ticket['Titulo']}")
            print(f"   Categoría: {ticket.get('CategoriaNombre', 'N/A')}")
            print(f"   Prioridad: {ticket['Prioridad']}")
            print(f"   Estado: {ticket['Estado']}")
            print(f"   Creado: {ticket['Fecha_creacion'][:16]}")
    
    def handle_view_all_tickets(self):
        """Muestra todos los tickets (admin only)"""
        if not self.auth_service.has_role('admin'):
            print("❌ No tienes permisos para esta acción.")
            return
        
        tickets = self.ticket_service.get_all_tickets()
        
        print(f"\n=== TODOS LOS TICKETS ({len(tickets)}) ===")
        if not tickets:
            print("No hay tickets en el sistema.")
            return
        
        for ticket in tickets:
            print(f"\n📋 Ticket #{ticket['ID']}")
            print(f"   Título: {ticket['Titulo']}")
            print(f"   Categoría: {ticket.get('CategoriaNombre', 'N/A')}")
            print(f"   Prioridad: {ticket['Prioridad']}")
            print(f"   Estado: {ticket['Estado']}")
            print(f"   Solicitante: {ticket.get('SolicitanteNombre', 'N/A')}")
            print(f"   Creado: {ticket['Fecha_creacion'][:16]}")

    def handle_close_ticket(self):
        """Permite a un administrador cerrar un ticket"""
        if not self.auth_service.has_role('admin'):
            print("❌ No tienes permisos para esta acción.")
            return

        try:
            ticket_id = int(input("ID del ticket a cerrar: "))
        except ValueError:
            print("❌ ID de ticket debe ser un número.")
            return

        tickets = self.ticket_service.get_all_tickets()
        ticket = next((t for t in tickets if t['ID'] == ticket_id), None)

        if not ticket:
            print("❌ El ticket especificado no existe.")
            return

        print(f"\n📋 Ticket #{ticket['ID']} - {ticket['Titulo']}")
        print(f"   Estado actual: {ticket['Estado']}")
        confirm = input("¿Confirmar cierre? (s/N): ").strip().lower()
        if confirm != 's':
            print("⚠️ Operación cancelada.")
            return

        admin = self.auth_service.get_current_user()
        if self.ticket_service.update_ticket_status(ticket_id, 'cerrado', admin.ID):
            print("✅ Ticket cerrado exitosamente.")
        else:
            print("❌ No se pudo cerrar el ticket.")
    
    def handle_view_comments(self):
        """Muestra comentarios de un ticket"""
        try:
            ticket_id = int(input("ID del ticket: "))
            user = self.auth_service.get_current_user()

            if user.Roll != 'admin':
                user_ticket_ids = {
                    ticket['ID'] for ticket in self.ticket_service.get_tickets_by_user(user.ID)
                }
                if ticket_id not in user_ticket_ids:
                    print("❌ No puedes consultar comentarios de tickets que no te pertenecen.")
                    return
            comments = self.ticket_service.get_comments_by_ticket(ticket_id)
            
            print(f"\n=== COMENTARIOS - Ticket #{ticket_id} ===")
            if not comments:
                print("No hay comentarios para este ticket.")
                return
            
            for comment in comments:
                print(f"\n👤 {comment.get('UsuarioNombre', 'Anónimo')} - {comment['Fecha_creacion'][:16]}")
                print(f"   {comment['Contenido']}")
                
        except ValueError:
            print("❌ ID de ticket debe ser un número.")
    
    def handle_add_comment(self):
        """Añade un comentario a un ticket"""
        try:
            ticket_id = int(input("ID del ticket: "))
            contenido = input("Comentario: ").strip()
            
            if not contenido:
                print("❌ El comentario no puede estar vacío.")
                return
            
            user = self.auth_service.get_current_user()

            if user.Roll != 'admin':
                user_ticket_ids = {
                    ticket['ID'] for ticket in self.ticket_service.get_tickets_by_user(user.ID)
                }
                if ticket_id not in user_ticket_ids:
                    print("❌ No puedes comentar tickets que no te pertenecen.")
                    return
            
            # Usar la versión que recibe parámetros directamente
            if self.ticket_service.add_comment(ticket_id, user.ID, contenido):
                print("✅ Comentario añadido exitosamente.")
            else:
                print("❌ Error al añadir el comentario.")
                
        except ValueError:
            print("❌ ID de ticket debe ser un número.")
    
    def handle_change_password(self):
        """Cambia la contraseña del usuario actual"""
        print("\n=== CAMBIAR CONTRASEÑA ===")
        
        current_password = getpass.getpass("Contraseña actual: ")
        new_password = getpass.getpass("Nueva contraseña: ")
        confirm_password = getpass.getpass("Confirmar nueva contraseña: ")
        
        if new_password != confirm_password:
            print("❌ Las nuevas contraseñas no coinciden.")
            return
        
        if len(new_password) < 4:
            print("❌ La nueva contraseña debe tener al menos 4 caracteres.")
            return
        
        user = self.auth_service.get_current_user()
        
        # Verificar contraseña actual
        if not self.auth_service.authenticate(user.Nombre, current_password):
            print("❌ Contraseña actual incorrecta.")
            return
        
        # Cambiar contraseña
        new_password_hash = self.auth_service.db_manager.hash_password(new_password)
        if self.user_service.change_password(user.ID, new_password_hash):
            print("✅ Contraseña cambiada exitosamente.")
        else:
            print("❌ Error al cambiar la contraseña.")