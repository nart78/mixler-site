// Auth Module - Mixler Event Platform
import { db } from './supabase-client.js';

// Get current session
async function getSession() {
  const { data: { session } } = await db.auth.getSession();
  return session;
}

// Get current user with profile
async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  return { ...session.user, profile };
}

// Sign up with email/password
async function signUp(email, password, fullName, phone) {
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName }
    }
  });

  if (error) throw error;

  // Update profile with phone if provided
  if (data.user && phone) {
    await db.from('profiles').update({ phone, full_name: fullName }).eq('id', data.user.id);
  }

  return data;
}

// Sign in with email/password
async function signIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Sign out
async function signOut() {
  const { error } = await db.auth.signOut();
  if (error) throw error;
  window.location.href = '/';
}

// Check if user is admin
async function isAdmin() {
  const user = await getCurrentUser();
  return user?.profile?.is_admin === true;
}

// Require auth - redirect to login if not authenticated
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?return=${returnUrl}`;
    return null;
  }
  return session;
}

// Require admin - redirect if not admin
async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;

  const admin = await isAdmin();
  if (!admin) {
    window.location.href = '/';
    return null;
  }
  return session;
}

// Listen for auth state changes
function onAuthChange(callback) {
  db.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

export { getSession, getCurrentUser, signUp, signIn, signOut, isAdmin, requireAuth, requireAdmin, onAuthChange };
