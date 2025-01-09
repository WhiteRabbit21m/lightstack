import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  CheckCircle, 
  XCircle, 
  Trash2, 
  Plus, 
  RefreshCw, 
  LogOut,
  AlertCircle 
} from 'lucide-react';
import { useAuth } from './authContext';

const LightstackDashboard = () => {
  const { token, logout, apiUrl } = useAuth();
  const [activeStacks, setActiveStacks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [formData, setFormData] = useState({
    phoenixd_domain: '',
    lnbits_domain: '',
    use_real_certs: false,
    use_postgres: false,
    email: ''
  });

  // Fetch active stacks
  const fetchStacks = async () => {
    try {
      const response = await fetch(`${apiUrl}/stacks`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch stacks');
      const data = await response.json();
      setActiveStacks(data);
    } catch (err) {
      setError('Failed to fetch stacks: ' + err.message);
    }
  };

  useEffect(() => {
    fetchStacks();
  }, [token]);

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value
    }));
  };

  // Handle toggle changes
  const handleToggleChange = (name) => {
    setFormData(prevState => ({
      ...prevState,
      [name]: !prevState[name]
    }));
  };

  // Handle stack addition
  const handleAddStack = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch(`${apiUrl}/stacks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to add stack');
      }

      const newStack = await response.json();
      setActiveStacks(prev => [...prev, newStack]);
      setSuccess('Stack added successfully! Please wait a few minutes for the setup to complete.');
      
      // Reset form
      setFormData({
        phoenixd_domain: '',
        lnbits_domain: '',
        use_real_certs: false,
        use_postgres: false,
        email: ''
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle stack removal
  const handleRemoveStack = async (stackId) => {
    if (!confirm('Are you sure you want to remove this stack? This action cannot be undone.')) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch(`${apiUrl}/stacks/${stackId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to remove stack');
      }

      setActiveStacks(prev => prev.filter(stack => stack.id !== stackId));
      setSuccess('Stack removed successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Lightstack Management</h1>
        <Button variant="outline" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </Button>
      </div>

      <Card>
        <CardContent className="p-6">
          <Tabs defaultValue="add">
            <TabsList className="mb-4">
              <TabsTrigger value="add">Add Stack</TabsTrigger>
              <TabsTrigger value="manage">Manage Stacks</TabsTrigger>
            </TabsList>

            <TabsContent value="add">
              <form onSubmit={handleAddStack} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phoenixd_domain">Phoenixd Domain</Label>
                  <Input
                    id="phoenixd_domain"
                    name="phoenixd_domain"
                    placeholder="api.yourdomain.com"
                    value={formData.phoenixd_domain}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lnbits_domain">LNbits Domain</Label>
                  <Input
                    id="lnbits_domain"
                    name="lnbits_domain"
                    placeholder="lnbits.yourdomain.com"
                    value={formData.lnbits_domain}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="use_real_certs"
                    checked={formData.use_real_certs}
                    onCheckedChange={() => handleToggleChange('use_real_certs')}
                  />
                  <Label htmlFor="use_real_certs">Use real Letsencrypt certificates</Label>
                </div>

                {formData.use_real_certs && (
                  <div className="space-y-2">
                    <Label htmlFor="email">Email for Letsencrypt</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="your@email.com"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                    />
                    <p className="text-sm text-gray-500">
                      This email will be used for important notifications about your SSL certificates.
                    </p>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Switch
                    id="use_postgres"
                    checked={formData.use_postgres}
                    onCheckedChange={() => handleToggleChange('use_postgres')}
                  />
                  <Label htmlFor="use_postgres">Use PostgreSQL</Label>
                </div>

                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Make sure your domains are correctly configured and pointing to this server before adding a stack.
                  </AlertDescription>
                </Alert>

                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Adding Stack...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Stack
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="manage">
              <div className="space-y-4">
                {activeStacks.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No active stacks found. Add your first stack using the "Add Stack" tab.
                  </div>
                ) : (
                  activeStacks.map(stack => (
                    <Card key={stack.id} className="p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-medium mb-1">Stack {stack.id}</h3>
                          <div className="text-sm text-gray-500 space-y-1">
                            <p>
                              <span className="font-medium">Phoenixd API:</span>{' '}
                              <a 
                                href={`https://${stack.phoenixd_domain}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {stack.phoenixd_domain}
                              </a>
                            </p>
                            <p>
                              <span className="font-medium">LNbits:</span>{' '}
                              <a 
                                href={`https://${stack.lnbits_domain}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {stack.lnbits_domain}
                              </a>
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRemoveStack(stack.id)}
                          disabled={isLoading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="mt-4">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LightstackDashboard;
