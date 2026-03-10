# Volume Discount Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-apply a configurable percentage discount when a buyer selects N+ tickets at checkout.

**Architecture:** Store volume discount config in the existing `custom_fields` JSONB column on events (no migration). Admin UI reads/writes it. Checkout frontend auto-applies it on quantity change. Backend edge function revalidates server-side before charging Stripe.

**Tech Stack:** HTML/JS (frontend), Supabase Edge Functions (Deno/TypeScript), Stripe API, PostgreSQL JSONB

**Spec:** `docs/superpowers/specs/2026-03-10-volume-discount-design.md`

---

## Chunk 1: Admin UI + Event Detail Page

### Task 1: Add Group Discount fields to admin event-edit form

**Files:**
- Modify: `admin/event-edit.html:179-192` (pricing section, after tax/CC fee fields)
- Modify: `admin/event-edit.html:533` (custom_fields loading)
- Modify: `admin/event-edit.html:581` (custom_fields saving)

- [ ] **Step 1: Add group discount HTML inputs**

In `admin/event-edit.html`, find the pricing section. After the "Pass credit card fee" checkbox (around line 182), add a new subsection:

```html
<div class="form-row" style="margin-top: 16px;">
  <h4 style="width:100%;margin:0 0 8px;">Group Discount</h4>
</div>
<div class="form-row">
  <div class="form-group">
    <label>Minimum Tickets</label>
    <input type="number" id="vol-min-qty" min="2" max="50" placeholder="e.g. 4">
  </div>
  <div class="form-group">
    <label>Discount %</label>
    <input type="number" id="vol-discount-pct" min="1" max="99" placeholder="e.g. 15">
  </div>
</div>
```

- [ ] **Step 2: Load volume discount from custom_fields on edit**

Find where `customFields = event.custom_fields || []` is set (around line 533). After that line, add:

```javascript
// Load volume discount fields
const volDiscount = event.custom_fields?.volume_discount;
if (volDiscount) {
  document.getElementById('vol-min-qty').value = volDiscount.min_qty || '';
  document.getElementById('vol-discount-pct').value = volDiscount.discount_pct || '';
}
```

- [ ] **Step 3: Save volume discount into custom_fields on submit**

Find the `eventData` object construction (around line 570-582). The current custom_fields line is:
```javascript
custom_fields: customFields.filter(cf => cf.label && cf.value),
```

Replace it with logic that preserves existing custom_fields (like puppies) and merges volume_discount:

```javascript
custom_fields: (() => {
  const cf = typeof customFields === 'object' && !Array.isArray(customFields)
    ? { ...customFields }
    : {};
  const minQty = parseInt(document.getElementById('vol-min-qty').value);
  const discPct = parseInt(document.getElementById('vol-discount-pct').value);
  if (minQty >= 2 && discPct >= 1 && discPct <= 99) {
    cf.volume_discount = { min_qty: minQty, discount_pct: discPct };
  } else {
    delete cf.volume_discount;
  }
  return cf;
})(),
```

**Important:** The current code treats custom_fields as an array of {label, value} objects for the generic custom fields feature. But we're now storing structured data (puppies, volume_discount) as object keys. Read the existing save logic carefully. The custom_fields column already has object data (e.g. Puppy Yoga has `{puppies: [...]}`) so the save must preserve all existing keys.

- [ ] **Step 4: Test in browser**

1. Go to admin/event-edit.html, edit the Puppy Yoga event
2. Verify the Group Discount fields appear below the pricing section
3. Enter min qty: 4, discount: 15
4. Save the event
5. Reload the page and verify the values persisted
6. Verify the puppies custom_fields data was NOT wiped out

- [ ] **Step 5: Commit**

```bash
git add admin/event-edit.html
git commit -m "feat: add group discount fields to event admin form"
```

---

### Task 2: Show group discount note on event detail page

**Files:**
- Modify: `event.html:154-159` (sidebar ticket-price section)

- [ ] **Step 1: Add volume discount note to sidebar**

In `event.html`, find the ticket-price div (around line 154-159). After the closing `</div>` of `ticket-price` and before `${ticketTypesHtml}`, add:

```javascript
${event.custom_fields?.volume_discount ? `
  <div class="volume-discount-note">
    <span>${event.custom_fields.volume_discount.discount_pct}% off when you buy ${event.custom_fields.volume_discount.min_qty}+ tickets</span>
  </div>
` : ''}
```

- [ ] **Step 2: Add CSS for the note**

In `css/events-page.css`, add after the existing ticket styles:

```css
.volume-discount-note {
  text-align: center;
  padding: 8px 12px;
  margin: -4px 0 12px;
  background: #eef2ff;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #153db6;
}
```

- [ ] **Step 3: Test in browser**

Visit `event.html?slug=puppy-yoga-apr-2026` and verify the note appears in the sidebar below the price.

- [ ] **Step 4: Commit**

```bash
git add event.html css/events-page.css
git commit -m "feat: show group discount note on event detail page"
```

---

## Chunk 2: Checkout Frontend

### Task 3: Auto-apply volume discount in checkout summary

**Files:**
- Modify: `checkout.html:306-359` (updateSummary function)
- Modify: `checkout.html:136-144` (quantity picker area, for nudge banner)
- Modify: `css/checkout.css` (banner + discount styling)

- [ ] **Step 1: Add nudge banner HTML**

In `checkout.html`, find the quantity picker section (around line 136-144). After the closing `</div>` of `quantity-picker`, before the closing `</div>` of `form-section`, add a placeholder div:

```html
<div class="volume-discount-nudge" id="vol-nudge" style="display:none;"></div>
```

- [ ] **Step 2: Add nudge banner CSS**

In `css/checkout.css`, add:

```css
.volume-discount-nudge {
  margin-top: 12px;
  padding: 10px 14px;
  background: #eef2ff;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  color: #153db6;
  text-align: center;
}
```

- [ ] **Step 3: Modify updateSummary() to calculate volume discount**

In `checkout.html`, find the `updateSummary()` function (starts around line 306). The current discount logic is:

```javascript
const discount = couponResult?.discount_cents || 0;
```

Replace with:

```javascript
// Volume discount calculation
const volDiscount = currentEvent.custom_fields?.volume_discount;
let volumeDiscountCents = 0;
if (volDiscount && quantity >= volDiscount.min_qty) {
  volumeDiscountCents = Math.round(subtotal * volDiscount.discount_pct / 100);
}
const couponDiscountCents = couponResult?.discount_cents || 0;

// Use whichever discount is larger
const discount = Math.max(volumeDiscountCents, couponDiscountCents);
const isVolumeDiscount = volumeDiscountCents > 0 && volumeDiscountCents >= couponDiscountCents;
```

- [ ] **Step 4: Update the discount display line in the summary HTML**

Find the discount display section in the summary HTML (around lines 338-343). Replace:

```javascript
${discount > 0 ? `
  <div class="summary-line discount">
    <span>Discount</span>
    <span>-${formatPrice(discount)}</span>
  </div>
` : ''}
```

With:

```javascript
${discount > 0 ? `
  <div class="summary-line discount">
    <span>${isVolumeDiscount
      ? 'Group discount (' + volDiscount.discount_pct + '% off)'
      : 'Discount'}</span>
    <span>-${formatPrice(discount)}</span>
  </div>
` : ''}
```

- [ ] **Step 5: Update the nudge banner visibility**

At the end of `updateSummary()`, before the closing brace, add:

```javascript
// Volume discount nudge banner
const nudgeEl = document.getElementById('vol-nudge');
if (nudgeEl && volDiscount) {
  if (quantity < volDiscount.min_qty) {
    nudgeEl.style.display = '';
    nudgeEl.textContent = `Buy ${volDiscount.min_qty}+ tickets and save ${volDiscount.discount_pct}%!`;
  } else {
    nudgeEl.style.display = 'none';
  }
} else if (nudgeEl) {
  nudgeEl.style.display = 'none';
}
```

- [ ] **Step 6: Pass volume discount info to handleCheckout()**

In `checkout.html`, find the `handleCheckout()` function (around line 574). Find where the POST body is constructed (around lines 626-639). The current body includes `coupon_code`. Add `volume_discount_applied`:

In the body JSON, add:

```javascript
volume_discount_applied: (() => {
  const vd = currentEvent.custom_fields?.volume_discount;
  if (vd && quantity >= vd.min_qty) {
    const volCents = Math.round(pricePerTicket * quantity * vd.discount_pct / 100);
    const coupCents = couponResult?.discount_cents || 0;
    return volCents >= coupCents;
  }
  return false;
})(),
```

- [ ] **Step 7: Test in browser**

1. Go to checkout for Puppy Yoga (after setting volume discount in admin)
2. With qty=1, verify nudge banner: "Buy 4+ tickets and save 15%!"
3. Increase to qty=4, verify:
   - Nudge banner disappears
   - "Group discount (15% off)" line appears in summary
   - Total reflects 15% off the subtotal
4. Decrease back to qty=3, verify nudge returns and discount disappears

- [ ] **Step 8: Commit**

```bash
git add checkout.html css/checkout.css
git commit -m "feat: auto-apply volume discount at checkout with nudge banner"
```

---

## Chunk 3: Backend Validation

### Task 4: Server-side volume discount validation in create-checkout-session

**Files:**
- Modify: `supabase/functions/create-checkout-session/index.ts:151-184` (discount section)
- Modify: `supabase/functions/create-checkout-session/index.ts:286-295` (Stripe coupon name)

- [ ] **Step 1: Add volume discount calculation after coupon validation**

In `create-checkout-session/index.ts`, find where `discountCents` is calculated from the coupon (around lines 155-184). After the coupon validation block, add:

```typescript
// Volume discount calculation
let volumeDiscountCents = 0;
const volDiscount = event.custom_fields?.volume_discount;
if (volDiscount && quantity >= volDiscount.min_qty && volDiscount.discount_pct > 0) {
  volumeDiscountCents = Math.round(subtotalCents * volDiscount.discount_pct / 100);
}

// Use whichever discount is larger (volume vs coupon)
const isVolumeDiscount = volumeDiscountCents > 0 && volumeDiscountCents >= discountCents;
if (isVolumeDiscount) {
  discountCents = volumeDiscountCents;
  validCouponId = null; // Don't attribute to coupon
}
```

- [ ] **Step 2: Update the Stripe coupon name**

Find where the Stripe coupon is created (around lines 286-295). Update the `name` field:

```typescript
name: isVolumeDiscount
  ? `Group discount (${volDiscount.discount_pct}% off)`
  : coupon_code ? `Coupon: ${coupon_code}` : 'Discount',
```

Note: The `isVolumeDiscount` variable needs to be accessible here. If it's scoped inside an if block, you may need to declare it at a higher scope (alongside `discountCents`).

- [ ] **Step 3: Deploy edge function**

```bash
cd ~/mixler-site
npx supabase functions deploy create-checkout-session --project-ref dnuygqdmzjswroyzvkjb
```

If Supabase CLI is not available, the edge function may need to be deployed via the Supabase dashboard.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts
git commit -m "feat: server-side volume discount validation in checkout"
```

---

## Chunk 4: Set Puppy Yoga discount + Deploy + Verify

### Task 5: Configure Puppy Yoga event and deploy

**Files:**
- No file changes, API + deploy only

- [ ] **Step 1: Set volume discount on Puppy Yoga event via API**

```bash
source ~/mixler-site/.env
curl -s -X PATCH "$SUPABASE_URL/rest/v1/events?slug=eq.puppy-yoga-apr-2026" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"custom_fields": {"puppies": [{"name":"Vogue","breed":"English Springer Spaniel","image":"images/puppies/vogue.jpg"},{"name":"Ella","breed":"Springer Doodle","image":"images/puppies/ella.jpg"},{"name":"Diva","breed":"Springer Doodle","image":"images/puppies/diva.jpg"},{"name":"Pixel","breed":"Springer Doodle","image":"images/puppies/pixel.jpg"},{"name":"Millie","breed":"Springer Doodle","image":"images/puppies/millie.jpg"},{"name":"Tuxedo","breed":"Poodle","image":"images/puppies/tuxedo.jpg"},{"name":"Cruise","breed":"Moyen Poodle","image":"images/puppies/cruise.jpg"}], "volume_discount": {"min_qty": 4, "discount_pct": 15}}}'
```

- [ ] **Step 2: Deploy frontend to VPS**

```bash
rsync -avz --delete ~/mixler-site/ root@198.71.51.250:/var/www/mixler.ca/ \
  --exclude='.git' --exclude='supabase' --exclude='scripts' --exclude='CLAUDE.md' --exclude='.github' --exclude='og' --exclude='.env'
```

- [ ] **Step 3: Regenerate OG previews**

```bash
ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"
```

- [ ] **Step 4: Push to GitHub**

```bash
cd ~/mixler-site && git push
```

- [ ] **Step 5: End-to-end verification**

1. Visit `mixler.ca/event.html?slug=puppy-yoga-apr-2026`
   - Verify "15% off when you buy 4+ tickets" note in sidebar
2. Click "Get Tickets" to go to checkout
   - With qty=1: verify nudge banner shows
   - With qty=4: verify discount line and correct total
3. Admin: edit Puppy Yoga, verify group discount fields are populated

### Task 6: Update Event Agent CLAUDE.md

**Files:**
- Modify: `~/mixler-events/CLAUDE.md`

- [ ] **Step 1: Add volume discount documentation to Event Agent**

Add to the Event Agent CLAUDE.md under the custom_fields section:

```markdown
- `custom_fields.volume_discount` - Object with `min_qty` (integer) and `discount_pct` (integer). Auto-applies discount at checkout when buyer selects min_qty or more tickets. Example: `{"min_qty": 4, "discount_pct": 15}` = 15% off for 4+ tickets.
```

- [ ] **Step 2: Commit**

```bash
git -C ~/mixler-events add CLAUDE.md
git -C ~/mixler-events commit -m "docs: add volume discount to Event Agent knowledge"
```
