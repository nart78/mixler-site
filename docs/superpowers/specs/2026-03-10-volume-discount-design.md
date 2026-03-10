# Volume Discount (Group Discount) Feature

Auto-apply a percentage discount when a buyer selects N or more tickets at checkout. Configurable per-event via admin UI.

## Data Storage

Use existing `custom_fields` JSONB on the events table. No migration needed.

```json
{
  "volume_discount": {
    "min_qty": 4,
    "discount_pct": 15
  }
}
```

Single threshold, single percentage. Both fields required when volume discount is active. Absence of `volume_discount` key means no discount for that event.

## Admin UI (event-edit.html)

Add a "Group Discount" section below the pricing fields in the event edit form.

- **Minimum tickets** number input (min 2, placeholder "e.g. 4")
- **Discount %** number input (1-99, placeholder "e.g. 15")
- Both optional. Leave blank to disable volume discount.
- On save, merge into `custom_fields` JSONB alongside any existing keys (puppies, etc.).
- On load, pre-fill from `custom_fields.volume_discount` if present.

## Checkout (checkout.html)

### Quantity change triggers discount check

When quantity changes (`updateSummary()` function):

1. Read `event.custom_fields?.volume_discount`
2. If exists and `quantity >= min_qty`:
   - Calculate: `volumeDiscount = Math.round(subtotal * discount_pct / 100)`
   - Compare with coupon discount (if any). Use the larger discount.
   - Show "Group discount (15% off)" line in order summary in green
3. If quantity < min_qty: no volume discount, use coupon discount if present

### Nudge banner

When volume discount is configured and qty < min_qty, show a banner near the quantity selector:
"Buy [min_qty]+ tickets and save [discount_pct]%!"

Banner disappears when threshold is met (discount is now applied). Styled with light blue background, Mixler blue text.

### Coupon interaction

Volume discount and coupon codes do NOT stack. The system compares both and applies whichever gives the larger discount. The order summary shows only the winning discount line.

If a coupon is applied and gives a bigger discount, the volume discount line is hidden. If volume discount wins, the coupon success message changes to note the group discount is better.

## Backend (create-checkout-session/index.ts)

Server-side revalidation (same logic as frontend):

1. Read `custom_fields.volume_discount` from the event row
2. If `quantity >= min_qty`, calculate: `Math.round(subtotal * discount_pct / 100)`
3. Also validate any coupon code (existing flow)
4. Use `Math.max(volumeDiscount, couponDiscount)` as the final discount
5. Store in `discount_cents` on the order (existing field)
6. If volume discount wins over coupon, do NOT store `coupon_id` on the order
7. Create Stripe coupon with `amount_off = final_discount_cents` (existing pattern)

## Event Detail Page (event.html)

In the ticket box sidebar, when `custom_fields.volume_discount` exists, show a note:
"Group discount: [discount_pct]% off when you buy [min_qty]+ tickets"

Styled subtly below the price display. Blue text, small font.

## Files to modify

| File | Change |
|------|--------|
| `admin/event-edit.html` | Add group discount inputs, save/load from custom_fields |
| `checkout.html` | Auto-apply logic, nudge banner, summary line |
| `css/checkout.css` | Banner + discount line styling |
| `event.html` | Sidebar group discount note |
| `supabase/functions/create-checkout-session/index.ts` | Server-side volume discount validation |

## Pricing calculation example

- Event: Puppy Yoga, $40/ticket
- Volume discount: 4+ tickets = 15% off
- Buyer selects 4 tickets

```
Subtotal:        $160.00  (4 x $40)
Group discount:  -$24.00  (15% of $160)
After discount:  $136.00
GST (5%):         $6.80
CC fee (3%):      $4.28   (3% of $142.80)
Total:          $147.08
```
