from typing import List
from database.database import DatabaseManager
from models.category import Category

class CategoryService:
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager
    
    def get_all_categories(self) -> List[Category]:
        """Obtiene todas las categorías"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM Categorias ORDER BY Nombre')
        categories_data = cursor.fetchall()
        conn.close()
        
        categories = []
        for cat_data in categories_data:
            categories.append(Category(
                ID=cat_data['ID'],
                Nombre=cat_data['Nombre'],
                Descripcion=cat_data['Descripcion']
            ))
        
        return categories
    
    def get_category_by_id(self, category_id: int) -> Category:
        """Obtiene una categoría por ID"""
        conn = self.db_manager._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM Categorias WHERE ID = ?', (category_id,))
        cat_data = cursor.fetchone()
        conn.close()
        
        if cat_data:
            return Category(
                ID=cat_data['ID'],
                Nombre=cat_data['Nombre'],
                Descripcion=cat_data['Descripcion']
            )
        return None