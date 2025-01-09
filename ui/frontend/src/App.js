import React from 'react';
import { AuthProvider } from './authContext';
import LoginPage from './LoginPage';
import LightstackDashboard from './LightstackDashboard';

const AppContent = () => {
  const { token } = useAuth();
  return token ? <LightstackDashboard /> : <LoginPage />;
};

const App = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
