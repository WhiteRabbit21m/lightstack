import React, { createContext, useState, useContext, useEffect } from 'react';
import { getApiUrl } from '@/lib/utils';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);
  const apiUrl = getApiUrl();

  useEffect(() => {
    const validateToken = async () => {
      if (token) {
        try {
          const response = await fetch(`${apiUrl}/health`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (!response.ok) {
            localStorage.removeItem('token');
            setToken(null);
          }
        } catch (error) {
          localStorage.removeItem('token');
          setToken(null);
        }
      }
      setIsLoading(false);
    };

    validateToken();
  }, [token]);

  const login = async (username, password) => {
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      const response = await fetch(`${apiUrl}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);
      return true;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>;
  }

  return (
    <AuthContext.Provider value={{ token, login, logout, apiUrl }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
