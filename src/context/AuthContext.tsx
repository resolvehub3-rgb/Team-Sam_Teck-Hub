import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, Organization, OrganizationMembership, UserRole } from '../types/database';
import { checkRolePermission, SystemAction } from '../utils/rules';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  membership: OrganizationMembership | null;
  role: UserRole | null;
  isLoading: boolean;
  systemSetupStatus: {
    checked: boolean;
    initialAdminProvisioned: boolean;
    canSetup: boolean;
  };
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  hasPermission: (action: SystemAction) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [systemSetupStatus, setSystemSetupStatus] = useState({
    checked: false,
    initialAdminProvisioned: false,
    canSetup: true,
  });

  const checkSetupStatus = async () => {
    try {
      const res = await fetch('/api/setup/status');
      if (res.ok) {
        const data = await res.json();
        setSystemSetupStatus({
          checked: true,
          initialAdminProvisioned: Boolean(data.initialAdminProvisioned),
          canSetup: Boolean(data.canSetup),
        });
      }
    } catch (err) {
      console.warn('Setup status fetch error:', err);
    }
  };

  const loadUserProfile = async (currentUser: User) => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch Profile
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

      if (profileData && !profileErr) {
        setProfile(profileData as Profile);
      } else {
        // Fallback profile if record hasn't synced
        setProfile({
          id: currentUser.id,
          email: currentUser.email || '',
          full_name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      // 2. Fetch Organization Membership
      const { data: memData } = await supabase
        .from('organization_memberships')
        .select('*, organization:organizations(*)')
        .eq('user_id', currentUser.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (memData) {
        setMembership(memData as OrganizationMembership);
        setRole(memData.role as UserRole);
        if (memData.organization) {
          setOrganization(memData.organization as Organization);
        }
      } else {
        // If user has no membership yet, default to team_member or check if they are the sole user
        setRole('team_member');
      }
    } catch (err) {
      console.error('Failed to load user profile & membership:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkSetupStatus();

    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user || null;
      setUser(currentUser);
      if (currentUser) {
        loadUserProfile(currentUser);
      } else {
        setProfile(null);
        setOrganization(null);
        setMembership(null);
        setRole(null);
        setIsLoading(false);
      }
    });

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user || null;
      setUser(currentUser);
      if (currentUser) {
        loadUserProfile(currentUser);
      } else {
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const refreshAuth = async () => {
    await checkSetupStatus();
    if (user) {
      await loadUserProfile(user);
    }
  };

  const signIn = async (email: string, password: string) => {
    if (isSupabaseConfigured()) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) {
        await refreshAuth();
        return {};
      }
    }

    // Try server-verified admin authentication
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUser(data.user);
        setProfile(data.profile);
        setOrganization(data.organization);
        setRole(data.role);
        return {};
      }
      return { error: data.error || 'Invalid credentials' };
    } catch {
      return { error: 'Authentication service unavailable' };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    if (!isSupabaseConfigured()) {
      return { error: 'Supabase credentials are not configured.' };
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (error) {
      return { error: error.message };
    }
    if (data.user) {
      // Create user profile record
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email,
        full_name: fullName,
      });
    }
    await refreshAuth();
    return {};
  };

  const signOut = async () => {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setProfile(null);
    setOrganization(null);
    setMembership(null);
    setRole(null);
  };

  const hasPermission = (action: SystemAction) => {
    return checkRolePermission(role || undefined, action);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        organization,
        membership,
        role,
        isLoading,
        systemSetupStatus,
        signIn,
        signUp,
        signOut,
        refreshAuth,
        hasPermission,
      }}
    >
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
