import sys
import os
from typing import Dict, Any, Callable, List, Optional
import threading
import time
import json  # <-- agregado

# Agregar el directorio actual al path para importaciones
sys.path.append(os.path.dirname(__file__))

from message import Message, MessageType, MessageStatus

# ---- agregado: helper de logging TX ----
def _log(tag: str, data: dict):
    """Imprime trafico del bus en JSON (TX-OUT / TX-IN)"""
    try:
        print(f"[{tag}] {json.dumps(data, ensure_ascii=False)}", flush=True)
    except Exception:
        # fallback por si hay objetos no serializables
        print(f"[{tag}] {str(data)}", flush=True)
# ----------------------------------------

class ServiceBus:
    def __init__(self):
        self.handlers: Dict[str, Callable] = {}
        self.message_queue: List[Message] = []
        self.responses: Dict[str, Any] = {}
        self._lock = threading.Lock()
        self._running = False
        self._processor_thread = None
    
    def register_handler(self, service: str, action: str, handler: Callable):
        """Registra un manejador para un servicio y acción específicos"""
        key = f"{service}.{action}"
        self.handlers[key] = handler
        print(f"✅ Handler registrado: {key}")
    
    def send_command(self, service: str, action: str, payload: Dict[str, Any]) -> Message:
        """Envía un comando y espera respuesta síncrona"""
        message = Message.create(MessageType.COMMAND, service, action, payload)
        
        # ---- agregado: log TX-OUT ----
        _log("TX-OUT", {"type":"request","service":service,"action":action,"payload":payload})
        # -------------------------------

        # Procesamiento síncrono
        response = self._process_message(message)
        message.response = response
        message.status = MessageStatus.PROCESSED

        # ---- agregado: log TX-IN ----
        _log("TX-IN", {"status":"ok","response":response})
        # ------------------------------

        return message
    
    def send_query(self, service: str, action: str, payload: Dict[str, Any]) -> Any:
        """Envía una consulta y retorna la respuesta"""
        message = Message.create(MessageType.QUERY, service, action, payload)

        # ---- agregado: log TX-OUT ----
        _log("TX-OUT", {"type":"request","service":service,"action":action,"payload":payload})
        # -------------------------------

        # Procesamiento síncrono
        response = self._process_message(message)

        # ---- agregado: log TX-IN ----
        _log("TX-IN", {"status":"ok","response":response})
        # ------------------------------

        return response
    
    def publish_event(self, service: str, event: str, payload: Dict[str, Any]):
        """Publica un evento (sin esperar respuesta)"""
        message = Message.create(MessageType.EVENT, service, event, payload)

        # ---- agregado: log TX-OUT ----
        _log("TX-OUT", {"type":"event","topic":f"{service}.{event}","payload":payload})
        # -------------------------------

        # Procesamiento asíncrono
        with self._lock:
            self.message_queue.append(message)
    
    def _process_message(self, message: Message) -> Any:
        """Procesa un mensaje y retorna la respuesta"""
        key = f"{message.service}.{message.action}"
        
        if key not in self.handlers:
            error_msg = f"No handler registered for {key}"
            message.error = error_msg
            message.status = MessageStatus.FAILED
            raise Exception(error_msg)
        
        try:
            handler = self.handlers[key]
            response = handler(message.payload)
            return response
        except Exception as e:
            message.error = str(e)
            message.status = MessageStatus.FAILED
            raise e
    
    def start_async_processing(self):
        """Inicia el procesamiento asíncrono de mensajes"""
        self._running = True
        self._processor_thread = threading.Thread(target=self._process_queue)
        self._processor_thread.daemon = True
        self._processor_thread.start()
        print("🚀 Bus de servicios iniciado (procesamiento asíncrono)")
    
    def stop_async_processing(self):
        """Detiene el procesamiento asíncrono"""
        self._running = False
        if self._processor_thread:
            self._processor_thread.join()
    
    def _process_queue(self):
        """Procesa la cola de mensajes asíncronos"""
        while self._running:
            with self._lock:
                if self.message_queue:
                    message = self.message_queue.pop(0)
                else:
                    message = None
            
            if message:
                try:
                    self._process_message(message)
                    # ---- agregado: ACK del evento procesado ----
                    _log("TX-IN", {"ack":"event_processed",
                                   "topic":f"{message.service}.{message.action}",
                                   "payload":message.payload})
                    # -------------------------------------------
                    print(f"📨 Evento procesado: {message.service}.{message.action}")
                except Exception as e:
                    print(f"❌ Error procesando evento {message.service}.{message.action}: {e}")
            
            time.sleep(0.1)

    # --- ya estaba: no se elimina; se agrega log TX-OUT opcional ---
    def publish_event(self, module, event_type, data):
           full_event_name = f"{module}.{event_type}"
           # log adicional
           _log("TX-OUT", {"type":"event","topic":full_event_name,"payload":data})
           if full_event_name in self.handlers:
            for handler in self.handlers[full_event_name]:
                try:
                    handler(data)
                except Exception as e:
                    print(f"Error ejecutando handler para {full_event_name}: {e}")
