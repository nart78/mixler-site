// Shared UI Components - Mixler Event Platform
import { getSession, signOut } from './auth.js';

// Render the site header/nav on every page
async function renderNav(activeLink) {
  const session = await getSession();
  const isLoggedIn = !!session;

  const nav = document.getElementById('site-nav');
  if (!nav) return;

  nav.innerHTML = `
    <header class="site-header">
      <nav class="nav container">
        <a href="/" class="nav-logo">Mixler<span>.</span></a>
        <ul class="nav-links">
          <li><a href="/events.html" class="${activeLink === 'events' ? 'active' : ''}">Events</a></li>
          <li><a href="/#how-it-works">How It Works</a></li>
          <li><a href="/#about">About</a></li>
          ${isLoggedIn ? `
            <li><a href="/account.html" class="${activeLink === 'account' ? 'active' : ''}">My Account</a></li>
            <li><a href="#" id="nav-logout" class="btn btn-outline">Log Out</a></li>
          ` : `
            <li><a href="/login.html" class="${activeLink === 'login' ? 'active' : ''}">Log In</a></li>
            <li><a href="/login.html?tab=signup" class="btn btn-primary">Sign Up</a></li>
          `}
        </ul>
        <button class="mobile-menu-btn" aria-label="Menu">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </nav>
    </header>
  `;

  // Mobile menu toggle
  const menuBtn = nav.querySelector('.mobile-menu-btn');
  const navLinks = nav.querySelector('.nav-links');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      navLinks.classList.toggle('active');
      menuBtn.classList.toggle('active');
    });
  }

  // Logout handler
  const logoutBtn = nav.querySelector('#nav-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut();
    });
  }
}

// Render the site footer (global standard)
function renderFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;

  footer.innerHTML = `
    <footer class="footer-dark">
      <div class="container">
        <div class="footer-dark-grid">
          <div class="footer-brand-dark">
            <a href="/" class="nav-logo"><img src="/images/mixler-white-wide.png" alt="Mixler" class="nav-logo-img"></a>
            <p>Calgary's go-to for fun nights out and real connections. Come for the event, stay for the people.</p>
          </div>
          <div class="footer-col-dark">
            <h4>Quick Links</h4>
            <a href="/events.html">All Events</a>
            <a href="/#how-it-works">How It Works</a>
            <a href="/#about">About</a>
          </div>
          <div class="footer-col-dark">
            <h4>Events</h4>
            <a href="/events.html">Social Mixers</a>
            <a href="/events.html">Trivia Nights</a>
            <a href="/events.html">Speed Friending</a>
          </div>
          <div class="footer-col-dark">
            <h4>Contact</h4>
            <a href="mailto:hello@mixler.ca">hello@mixler.ca</a>
            <a href="/login.html">My Account</a>
          </div>
        </div>
        <div class="footer-bottom-dark">
          <span>&copy; ${new Date().getFullYear()} Mixler. All rights reserved.</span>
          <div class="footer-social-dark">
            <a href="https://www.instagram.com/mixler.ca" target="_blank" rel="noopener" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></a>
            <a href="https://www.facebook.com/Mixler/" target="_blank" rel="noopener" aria-label="Facebook"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></a>
          </div>
          <span><a href="#">Privacy</a> &bull; <a href="#">Terms</a></span>
        </div>
      </div>
    </footer>
  `;
}

// Render an event card
function renderEventCard(event) {
  const isComingSoon = event.event_date >= '2099-01-01';
  const date = new Date(event.event_date + 'T' + event.start_time);
  const dateStr = isComingSoon ? 'Date TBD' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const spotsLeft = event.capacity - event.tickets_sold;
  const soldOut = spotsLeft <= 0;
  const priceStr = (event.price_cents / 100).toFixed(2);
  const priceDisplay = isComingSoon ? 'Coming Soon' : (soldOut ? 'Sold Out' : '$' + priceStr);
  const btnText = isComingSoon ? 'Notify Me' : (soldOut ? 'Join waitlist' : 'See details');

  return `
    <a href="/event.html?slug=${event.slug}" class="event-card" style="${event.image_url ? `background-image:url('${event.image_url}')` : ''}">
      <div class="event-card-overlay"></div>
      <div class="event-card-content">
        <h3>${event.title}</h3>
        <p class="event-short-desc">${event.short_description || ''}</p>
        <span class="event-card-btn">${btnText} <span class="btn-arrow">&rarr;</span></span>
      </div>
      <div class="event-card-meta">
        <span class="event-tag">${priceDisplay}</span>
        <span class="event-date-tag">${dateStr}</span>
      </div>
    </a>
  `;
}

// Show a toast notification
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Loading spinner
function showLoading(container) {
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
}

export { renderNav, renderFooter, renderEventCard, showToast, showLoading };
