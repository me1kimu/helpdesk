
import sqlite3
import hashlib
import hmac
import os
from typing import List, Dict, Any, Optional
from models.user import User
from models.ticket import Ticket
from models.comment import Comment
from models.category import Category

class DatabaseManager:
    _PBKDF2_ITERATIONS = 600_000

    def __init__(self, db_name: str = "sistema_tickets.db"):
        self.db_name = db_name
        self._create_tables()
        self._initialize_data()
    
    def _get_connection(self):
        """Obtiene una conexión a la base de datos"""
        conn = sqlite3.connect(self.db_name)
        conn.row_factory = sqlite3.Row
        return conn
    
    def _create_tables(self):
        """Crea las tablas necesarias"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Tabla de Usuarios
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Usuarios (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                Nombre TEXT NOT NULL UNIQUE,
                Email TEXT UNIQUE,
                Password_hash TEXT NOT NULL,
                Roll TEXT NOT NULL DEFAULT 'user',
                Fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                Estado TEXT DEFAULT 'activo',
                Activo BOOLEAN DEFAULT 1
            )
        ''')
        
        # Tabla de Categorías
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Categorias (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                Nombre TEXT NOT NULL UNIQUE,
                Descripcion TEXT
            )
        ''')
        
        # Tabla de Tickets
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Ticket (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                Titulo TEXT NOT NULL,
                Categoria_ID INTEGER,
                Prioridad TEXT DEFAULT 'media',
                Estado TEXT DEFAULT 'abierto',
                Fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                Fecha_cierre DATETIME,
                Solicitante_ID INTEGER,
                Ejecutivo_ID INTEGER,
                FOREIGN KEY (Categoria_ID) REFERENCES Categorias (ID),
                FOREIGN KEY (Solicitante_ID) REFERENCES Usuarios (ID),
                FOREIGN KEY (Ejecutivo_ID) REFERENCES Usuarios (ID)
            )
        ''')
        
        # Tabla de Comentarios
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Comentarios (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                Contenido TEXT NOT NULL,
                Fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                Ticket_ID INTEGER,
                Usuario_ID INTEGER,
                FOREIGN KEY (Ticket_ID) REFERENCES Ticket (ID),
                FOREIGN KEY (Usuario_ID) REFERENCES Usuarios (ID)
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def _initialize_data(self):
        """Inicializa datos por defecto"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Categorías por defecto
        categorias = [
            ('Soporte Técnico', 'Problemas técnicos y de software'),
            ('Facturación', 'Problemas con facturas y pagos'),
            ('Ventas', 'Consultas sobre productos y servicios'),
            ('General', 'Otras consultas generales')
        ]
        
        cursor.executemany('''
            INSERT OR IGNORE INTO Categorias (Nombre, Descripcion) 
            VALUES (?, ?)
        ''', categorias)
        
        # Usuario administrador por defecto
        admin_password = self.hash_password('tecnico1234')
        cursor.execute('''
            INSERT OR IGNORE INTO Usuarios 
            (Nombre, Email, Password_hash, Roll, Estado, Activo) 
            VALUES (?, ?, ?, ?, ?, ?)
        ''', ('tecnico 1', 'tecnico1@sistema.com', admin_password, 'tecnico', 'activo', 1))
        
        conn.commit()
        conn.close()
    
    def hash_password(self, password: str) -> str:
        """Hashea una contraseña"""
        salt = os.urandom(16).hex()
        password_hash = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            bytes.fromhex(salt),
            self._PBKDF2_ITERATIONS
        ).hex()
        return f"pbkdf2_sha256${self._PBKDF2_ITERATIONS}${salt}${password_hash}"

    def verify_password(self, password: str, stored_hash: str) -> bool:
        """Verifica una contraseña usando PBKDF2"""
        try:
            algorithm, iterations, salt, expected_hash = stored_hash.split('$', 3)
            if algorithm != 'pbkdf2_sha256':
                return False

            calculated_hash = hashlib.pbkdf2_hmac(
                'sha256',
                password.encode('utf-8'),
                bytes.fromhex(salt),
                int(iterations)
            ).hex()
            return hmac.compare_digest(calculated_hash, expected_hash)
        except (ValueError, TypeError):
            return False