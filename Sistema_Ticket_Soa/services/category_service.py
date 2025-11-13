from typing import List, Dict, Any
from database.database import DatabaseManager

class CategoryService:
    def __init__(self, db_manager: DatabaseManager, service_bus):
        self.db_manager = db_manager
        self.service_bus = service_bus
        self._register_handlers()
    
    def _register_handlers(self):
        """Registra los manejadores en el bus"""
        self.service_bus.register_handler("categories", "get_all", self._handle_get_all_categories)
    
    def _handle_get_all_categories(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Obtiene todas las categorías"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM Categorias ORDER BY ID')
        categories_data = cursor.fetchall()
        conn.close()
        
        categories = []
        for cat_data in categories_data:
            categories.append(dict(cat_data))
        
        return categories
    
    # Método de conveniencia para compatibilidad
    def get_all_categories(self) -> List[Dict[str, Any]]:
        """Método de conveniencia para obtener categorías"""
        return self.service_bus.send_query("categories", "get_all", {})