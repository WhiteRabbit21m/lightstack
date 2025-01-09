from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import jwt
from datetime import datetime, timedelta
import subprocess
import os
import json
import re
from pathlib import Path

app = FastAPI(title="Lightstack UI API")

# Configurazione CORS per produzione
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In produzione sarà il dominio specifico
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configurazione
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key")  # Cambiato durante l'installazione
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Trova il path dello script init.sh
BASE_DIR = Path(__file__).resolve().parent.parent.parent
INIT_SCRIPT = str(BASE_DIR / "init.sh")

# Memorizzazione utenti (modificato durante l'installazione)
USERS_DB = {
    "admin": {
        "username": "admin",
        "password": "adminpassword",
    }
}

# Modelli Pydantic
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class User(BaseModel):
    username: str

class UserInDB(User):
    password: str

class Stack(BaseModel):
    phoenixd_domain: str
    lnbits_domain: str
    use_real_certs: bool
    use_postgres: bool
    email: Optional[str] = None

class StackResponse(BaseModel):
    id: str
    phoenixd_domain: str
    lnbits_domain: str

# Setup sicurezza
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Funzioni di autenticazione
def verify_password(plain_password: str, username: str) -> bool:
    user = USERS_DB.get(username)
    if not user:
        return False
    return plain_password == user["password"]

def get_user(username: str) -> Optional[UserInDB]:
    if username in USERS_DB:
        user_dict = USERS_DB[username]
        return UserInDB(**user_dict)
    return None

def authenticate_user(username: str, password: str) -> Optional[UserInDB]:
    user = get_user(username)
    if not user:
        return None
    if not verify_password(password, username):
        return None
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except jwt.PyJWTError:
        raise credentials_exception
    user = get_user(token_data.username)
    if user is None:
        raise credentials_exception
    return user

# Endpoints
@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/stacks", response_model=List[StackResponse])
async def get_stacks(current_user: User = Depends(get_current_user)):
    try:
        result = subprocess.run(
            [INIT_SCRIPT, "list"], 
            capture_output=True, 
            text=True,
            check=True
        )
        
        stacks = []
        for line in result.stdout.strip().split("\n"):
            if line:
                id, phoenixd, lnbits = line.split()
                stacks.append({
                    "id": id,
                    "phoenixd_domain": phoenixd,
                    "lnbits_domain": lnbits
                })
        return stacks
    except subprocess.CalledProcessError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list stacks: {e.stderr}"
        )

@app.post("/stacks", response_model=StackResponse)
async def add_stack(stack: Stack, current_user: User = Depends(get_current_user)):
    try:
        # Prepara le risposte automatiche per lo script
        answers = f"""{stack.phoenixd_domain}
{stack.lnbits_domain}
{"y" if stack.use_real_certs else "n"}
{stack.email if stack.use_real_certs else ""}
{"y" if stack.use_postgres else "n"}
y
"""
        
        # Esegue lo script init.sh
        process = subprocess.Popen(
            [INIT_SCRIPT, "add"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        stdout, stderr = process.communicate(input=answers)
        
        if process.returncode != 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to add stack: {stderr}"
            )
            
        # Estrae l'ID dello stack dall'output
        match = re.search(r"stack_(\d+)", stdout)
        if not match:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to extract stack ID from output"
            )
        
        stack_id = match.group(1)
            
        return {
            "id": stack_id,
            "phoenixd_domain": stack.phoenixd_domain,
            "lnbits_domain": stack.lnbits_domain
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.delete("/stacks/{stack_id}")
async def remove_stack(stack_id: str, current_user: User = Depends(get_current_user)):
    try:
        # Esegue lo script init.sh con il comando delete
        process = subprocess.Popen(
            [INIT_SCRIPT, "del"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        stdout, stderr = process.communicate(input=f"{stack_id}\ny\n")
        
        if process.returncode != 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to remove stack: {stderr}"
            )
            
        return JSONResponse(content={"message": f"Stack {stack_id} removed successfully"})
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
