FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONPATH=/app/Sistema_Ticket_Soa:/app
CMD ["python","-m","Sistema_Ticket_Soa.main"]
