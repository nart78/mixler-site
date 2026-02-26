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

// Render the site footer
function renderFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;

  footer.innerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a href="/" class="nav-logo">Mixler<span>.</span></a>
            <p>Calgary's go-to for fun nights out and real connections. Come for the event, stay for the people.</p>
            <div class="footer-social">
              <a href="#" aria-label="Instagram">IG</a>
              <a href="#" aria-label="Facebook">FB</a>
              <a href="#" aria-label="TikTok">TT</a>
            </div>
          </div>
          <div class="footer-col">
            <h4>Quick Links</h4>
            <a href="/events.html">Events</a>
            <a href="/#how-it-works">How It Works</a>
            <a href="/#about">About</a>
          </div>
          <div class="footer-col">
            <h4>Events</h4>
            <a href="/events.html">Social Mixers</a>
            <a href="/events.html">Activity Nights</a>
            <a href="/events.html">Speed Friending</a>
          </div>
          <div class="footer-col">
            <h4>Contact</h4>
            <a href="mailto:hello@mixler.ca">hello@mixler.ca</a>
            <a href="#">Calgary, AB</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; ${new Date().getFullYear()} Mixler. All rights reserved.</span>
          <span><a href="#">Privacy</a> &bull; <a href="#">Terms</a></span>
        </div>
      </div>
    </footer>
  `;
}

// Render an event card
function renderEventCard(event) {
  const date = new Date(event.event_date + 'T' + event.start_time);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const spotsLeft = event.capacity - event.tickets_sold;
  const soldOut = spotsLeft <= 0;
  const priceStr = (event.price_cents / 100).toFixed(2);

  return `
    <div class="event-card">
      <div class="event-image" ${event.image_url ? `style="background-image:url('${event.image_url}');background-size:cover;background-position:center;"` : ''}></div>
      <div class="event-content">
        <span class="event-tag">${soldOut ? 'Sold Out' : '$' + priceStr}</span>
        <h3>${event.title}</h3>
        <div class="event-meta">${dateStr} &bull; ${timeStr} &bull; ${event.location_name || ''}</div>
        <p class="event-short-desc">${event.short_description || ''}</p>
        ${soldOut
          ? `<a href="/event.html?slug=${event.slug}" class="btn btn-outline">Join Waitlist</a>`
          : `<a href="/event.html?slug=${event.slug}" class="btn btn-primary">Get Tickets</a>`
        }
      </div>
    </div>
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
