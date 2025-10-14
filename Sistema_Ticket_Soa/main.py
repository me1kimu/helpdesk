from database.database import DatabaseManager
from services.auth import AuthService
from services.user_service import UserService
from services.ticket_services import TicketService
from services.category_service import CategoryService
from Interfaces.terminal_interface import TerminalInterface

class TicketSystemApp:
    def __init__(self):
        # Inicializar base de datos
        self.db_manager = DatabaseManager()
        
        # Inicializar servicios
        self.auth_service = AuthService(self.db_manager)
        self.user_service = UserService(self.db_manager)
        self.ticket_service = TicketService(self.db_manager)
        self.category_service = CategoryService(self.db_manager)
        
        # Inicializar interfaz
        self.interface = TerminalInterface(
            self.auth_service,
            self.user_service,
            self.ticket_service,
            self.category_service
        )
    
    def run(self):
        """Ejecuta la aplicación principal"""
        self.interface.clear_screen()
        
        while True:
            if not self.auth_service.is_authenticated():
                # Menú principal (sin autenticación)
                self.interface.show_main_menu()
                choice = input("Selecciona una opción: ").strip()
                
                if choice == "1":
                    if self.interface.handle_login():
                        input("\nPresiona Enter para continuar...")
                        self.interface.clear_screen()
                
                elif choice == "2":
                    if self.interface.handle_registration():
                        input("\nPresiona Enter para continuar...")
                        self.interface.clear_screen()
                
                elif choice == "3":
                    print("👋 ¡Hasta luego!")
                    break
                
                else:
                    print("❌ Opción inválida.")
                    input("Presiona Enter para continuar...")
                    self.interface.clear_screen()
            
            else:
                # Menú de usuario (autenticado)
                self.interface.show_user_menu()
                choice = input("Selecciona una opción: ").strip()
                
                if choice == "1":
                    self.interface.handle_create_ticket()
                elif choice == "2":
                    self.interface.handle_view_my_tickets()
                elif choice == "3":
                    self.interface.handle_view_comments()
                elif choice == "4":
                    self.interface.handle_add_comment()
                elif choice == "5":
                    self.interface.handle_change_password()
                elif choice == "6" and self.auth_service.has_role('admin'):
                    self.interface.handle_view_all_tickets()
                elif choice == "0":
                    self.auth_service.logout()
                    self.interface.clear_screen()
                else:
                    print("❌ Opción inválida.")
                
                input("\nPresiona Enter para continuar...")
                self.interface.clear_screen()

if __name__ == "__main__":
    app = TicketSystemApp()
    app.run()