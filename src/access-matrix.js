// Source: customer-supplied matrix, 6 November 2026. F/C/V/R/A/N are labels,
// not unrestricted runtime grants. Restricted entries require a scoped policy.
const labels={F:'Full Access',C:'Create & Edit',V:'View Only',R:'Restricted Access',A:'Approval Access',N:'No Access'};
const roles=[['property_owner','Property Owner'],['super_admin','Super Admin'],['admin_manager','Admin Manager'],['finance_manager','Finance Manager'],['front_desk','Front Desk']];
const source=`
@dashboard|Dashboard & Analytics
Real-time property dashboard|C|V|R
Multi-property dashboard|R|V|N
Occupancy overview|C|V|R
Daily, weekly and monthly revenue|V|V|N
Today's arrivals and departures|V|V|V
In-house guest summary|V|N|V
Available, occupied and blocked rooms|C|V|R
ADR and RevPAR tracking|V|V|N
Revenue and occupancy trends|V|V|N
Property performance comparison|V|V|N
Custom date filters|C|C|C
Dashboard widgets and personalisation|C|C|C
@property|Property & Room Management
Property creation and configuration|R|N|N
Multi-property management|R|V|N
Property profile and contact information|C|V|V
Room type and category creation|C|N|V
Room inventory management|C|V|V
Room numbering and floor mapping|C|N|V
Room amenities configuration|C|N|V
Room status management|C|N|R
Room blocking and unblocking|C|N|R
Out-of-order and out-of-service rooms|C|V|R
Room allocation and reassignment|C|N|C
Property-specific staff assignment|R|N|N
@reservations|Reservations & Bookings
Direct reservations|C|V|C
Walk-in bookings|C|V|C
Individual reservations|C|V|C
Group reservations|C|V|C
Corporate reservations|C|V|R
Multi-room reservations|C|V|C
Reservation calendar|C|V|C
Drag-and-drop room allocation|C|N|C
Booking modification|C|V|R
Booking extension|C|V|C
Booking cancellation|C|V|R
No-show management|C|V|C
Booking confirmation and vouchers|C|V|C
Booking source tracking|C|V|V
Advance deposit tracking|C|C|R
Reservation history|V|V|V
Booking duplication and merging|C|N|R
Waitlist management|C|N|C
@front_desk|Front Desk Operations
Guest check-in|C|N|C
Guest check-out|C|V|C
Early check-in|C|N|R
Late check-out|C|N|R
Express check-in and check-out|C|N|C
Guest ID and document verification|C|N|R
Room assignment and room changes|C|N|C
Guest registration cards|C|N|C
In-house guest management|C|N|C
Stay extensions|C|V|C
Guest special instructions|C|N|C
Shift handover|C|N|C
Cashier shift opening and closing|C|C|R
Key issuance and tracking|C|N|C
@guest_crm|Guest CRM & Enquiry Management
Guest profile creation|C|N|C
Guest contact management|C|R|C
Guest stay history|V|R|V
Enquiry creation|C|N|C
Enquiry source tracking|C|N|V
Enquiry assignment|C|N|R
Follow-up reminders|C|N|C
Enquiry-to-booking conversion|C|N|C
Guest preferences|C|N|C
Guest segmentation|C|N|N
Corporate customer profiles|C|V|R
Travel agent profiles|C|V|R
Guest feedback and complaints|C|N|C
Repeat guest identification|V|N|V
Guest communication history|V|R|R
@revenue|Rates, Tariffs & Revenue Management
Base tariff configuration|C|V|V
Seasonal pricing|C|V|V
Weekend pricing|C|V|V
Dynamic pricing rules|C|V|N
Occupancy-based pricing|C|V|N
Rate plan management|C|V|V
Meal plan configuration|C|V|V
Corporate negotiated rates|C|V|R
Discount creation|C|V|R
Coupon and promotional code management|C|V|R
Minimum and maximum stay restrictions|C|V|V
Stop-sell management|C|V|V
Bulk tariff updates|C|V|N
Revenue forecasting|V|V|N
Tariff change approval workflows|A|A|R|V|N
Rate change history|V|V|N
@channels|Channel Manager & OTA Integration
OTA account connection|C|V|V
OTA credential management|R|N|N
Room type mapping|C|V|V
Rate plan mapping|C|V|V
Two-way availability synchronisation|C|V|V
Two-way rate synchronisation|C|V|V
OTA reservation import|C|V|V
Booking modification synchronisation|C|V|V
Cancellation synchronisation|C|V|V
Centralised inventory management|C|V|V
Overbooking prevention|C|V|V
Channel-specific pricing|C|V|V
OTA commission configuration|C|C|N
OTA performance reports|V|V|N
Synchronisation error monitoring|C|N|V
Automatic retry and recovery|R|N|N
Bulk rate and inventory updates|C|V|V
OTA connection health monitoring|V|N|V
Channel activation and deactivation|C|V|V
Synchronisation activity logs|V|N|N
@booking_engine|Direct Booking Engine
Hotel website booking widget|C|V|V
Live room availability search|V|V|V
Online reservation creation|C|V|C
Online payment collection|V|C|V
Promotional code application|C|V|R
Multi-room booking|C|V|C
Booking confirmation|C|V|C
Mobile-responsive booking interface|V|V|V
Cancellation policy display|C|V|V
Booking modification requests|C|V|C
Multi-property booking search|R|V|R
Booking engine branding|C|N|N
@housekeeping|Housekeeping & Maintenance
Housekeeping dashboard|C|N|V
Room cleaning schedules|C|N|V
Housekeeping task assignments|C|N|R
Clean, dirty and inspected room statuses|C|N|R
Room inspection checklists|C|N|V
Linen tracking|C|N|R
Room amenities replenishment|C|N|R
Maintenance requests|C|N|C
Work-order assignment|C|N|R
Out-of-order room tracking|C|V|V
Maintenance history|V|N|V
Staff task completion monitoring|C|N|R
Housekeeping productivity reports|V|N|N
@billing|Payments, Folios & Billing
Guest folio creation|C|C|R
Room charge posting|C|C|R
Additional service charges|C|C|R
Split folios|C|C|R
Merged folios|C|C|R
Advance payment management|C|C|R
Partial payment settlement|C|C|R
Full payment settlement|C|C|R
Refund processing|A|A|R|A|N
GST and tax configuration|V|C|N
Tax invoice generation|C|C|R
Credit notes|R|C|N
Payment gateway integration|N|R|N
Cash, card, UPI and bank transfer recording|C|C|R
Outstanding dues tracking|C|C|R
Corporate billing|C|C|N
Payment reconciliation|V|C|N
Invoice download and sharing|C|C|R
@finance|Finance & Night Audit
Daily revenue reconciliation|V|C|N
Night audit|R|C|R
Business-date closing|R|C|N
Cashier shift reconciliation|V|C|R
Revenue by department|V|V|N
Tax summaries|V|C|N
Accounts receivable|V|C|N
Refund approval|A|A|N|A|N
Financial adjustment approval|A|A|N|A|N
Financial audit trail|V|V|N
Daily collection reports|V|C|N
Accounting software integration|N|R|N
Outstanding balance ageing|V|C|N
Financial period closing|A|A|N|R|N
@internal_chat|In-House Chat & Communication
Organization-wide communication environment|R|R|R
Property-specific channels|C|C|C
Department-specific channels|C|R|R
One-to-one direct messaging|C|C|C|C|C
Cross-property staff messaging|C|C|R|R|R
Group owner announcements|F|C|V|V|V
Pinned messages and instructions|C|R|V
Message read receipts|C|C|C|C|C
Announcement acknowledgements|C|C|C|C|C
Real-time notifications|C|C|C|C|C
File and image sharing|C|C|C|C|C
Message search|R|R|R|R|R
Conversation history|R|R|R|R|R
Staff escalations|C|C|R
Escalation assignments|C|R|R
Role-based channel permissions|R|N|N
Channel member management|R|N|N
Message retention and audit controls|N|N|N
PMS record sharing in conversations|R|R|R|R|R
Tariff change requests linked to PMS workflows|A|A|C|V|N
@notifications|WhatsApp, Email & Notifications
WhatsApp click-to-chat|C|C|C|C|C
WhatsApp Business API integration|N|N|N
Two-way WhatsApp messaging|C|C|C|R|R
Booking confirmation templates|C|V|R
Check-in reminders|C|N|C
Checkout reminders|C|N|C
Payment reminders|C|C|R
Guest broadcast campaigns|R|N|N
Email notifications|C|R|R
Staff notification preferences|C|C|C|C|C
Notification delivery tracking|C|R|R
Communication template management|C|R|N
Consent and opt-out management|C|R|R
Scheduled messages|C|R|R
@multi_property|Multi-Property Management
Organization-level workspace|R|R|R
Centralised property dashboard|R|V|N
Property switching|R|R|R
Consolidated reservation reporting|V|V|N
Cross-property availability search|R|V|R
Central reservation management|R|V|R
Property-wise revenue comparison|V|V|N
Centralised staff access|R|N|N
Shared guest profiles with access controls|R|R|R
Organization-wide announcements|F|C|V|V|V
Property-specific operational settings|C|R|N
Consolidated financial reports|V|V|N
Property-level permission management|R|N|N
@reports|Reports & Business Intelligence
Occupancy reports|V|V|R
Reservation reports|V|V|R
Revenue reports|V|V|N
ADR and RevPAR reports|V|V|N
Booking source reports|V|V|N
OTA performance reports|V|V|N
Cancellation reports|V|V|R
No-show reports|V|V|R
Guest history reports|R|N|R
Outstanding payment reports|V|C|R
Tax and GST reports|V|C|N
Housekeeping productivity reports|V|N|N
Staff performance reports|V|N|N
Custom date-range reports|C|C|R
Excel export|R|R|R
CSV export|R|R|R
PDF export|R|R|R
Scheduled report delivery|C|C|N
Multi-property comparison reports|V|V|N
@staff|Staff, Roles & Access Management
Property Owner role|F|V|N|N|N
Super Admin role|F|R|N|N|N
Admin Manager role|V|N|N
Finance Manager role|N|V|N
Front Desk role|R|N|V
Custom staff roles|N|N|N
Role-based module permissions|V|N|N
Feature-level permissions|V|N|N
Property-level access restrictions|R|N|N
User invitations|R|N|N
User activation|R|N|N
User suspension and deactivation|R|N|N
Password reset|R|R|R
Account recovery|R|R|R
User activity logs|V|N|N
Multi-factor authentication|C|C|C|C|C
Session management|R|R|R
Staff access review|R|N|N
@integrations|Integrations & Developer APIs
REST API access|R|N|N
API key management|N|N|N
API credential rotation|N|N|N
Webhook configuration|R|N|N
User creation APIs|N|N|N
User update and deactivation APIs|N|N|N
Reservation APIs|R|N|N
Availability and inventory APIs|R|N|N
Rate management APIs|R|N|N
Payment integration APIs|N|R|N
Third-party CRM integrations|R|N|N
Accounting integrations|N|R|N
POS integrations|R|R|N
Integration activity logs|V|R|N
API monitoring|V|N|N
API rate limiting|N|N|N
API access scopes|N|N|N
@guest_experience|Guest Experience & Loyalty
Guest self-service portal|C|N|R
Digital registration forms|C|N|C
Pre-arrival information collection|C|N|C
Digital check-in requests|C|N|C
Guest service requests|C|N|C
Guest feedback forms|C|N|R
Review collection|C|N|R
Loyalty programmes|C|V|R
Membership management|C|V|R
Guest offers and packages|C|V|R
Additional service upselling|C|V|C
Guest preference management|C|N|C
@subscription|Subscription & SaaS Administration
Basic plan management|V|V|N
Premium plan management|V|V|N
Enterprise plan management|V|V|N
Feature-based plan restrictions|V|V|N
Property limits|V|V|N
Room inventory limits|V|V|N
Trial account management|N|V|N
Subscription activation|N|R|N
Subscription renewal|V|R|N
Plan upgrades and downgrades|N|R|N
Subscription invoices|V|C|N
Usage monitoring|V|V|N
Organization onboarding|R|N|N
Tenant-level configuration|N|N|N
Storage and usage limits|V|V|N
Subscription suspension and reactivation|N|V|N
@settings|Settings, Security & Localisation
Organization settings|N|N|N
Property settings|C|R|N
User-level language preferences|C|C|C|C|C
English interface|C|C|C|C|C
Kannada interface|C|C|C|C|C
Currency configuration|R|V|N
Timezone configuration|R|V|N
Date and time formats|C|C|C
Tax and invoice settings|V|C|N
Notification settings|C|C|C
Audit logs|V|R|N
Data export|R|R|N
Backup and recovery|N|N|N
Data retention policies|N|N|N
Role-based security|V|N|N
Privacy and consent controls|R|R|R
Mobile-responsive interface|C|C|C|C|C
Login and authentication settings|R|R|R
`;
const slug=text=>text.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const modules=[],features=[];let currentModule;
for(const line of source.trim().split('\n')){
 const [name,...cells]=line.split('|');
 if(name.startsWith('@')){currentModule={key:name.slice(1),name:cells[0]};modules.push(currentModule);continue;}
 const values=cells.length===3?['F','F',...cells]:cells;
 if(values.length!==5||values.some(x=>!labels[x]))throw Error('Invalid matrix row: '+line);
 features.push(Object.freeze({key:currentModule.key+'.'+slug(name),module:currentModule.key,name,labels:Object.fromEntries(roles.map(([role],i)=>[role,labels[values[i]]])),entitlement:currentModule.key==='internal_chat'?'internal_chat':currentModule.key}));
}
if(new Set(features.map(f=>f.key)).size!==features.length)throw Error('Duplicate permission key.');
module.exports={modules,features,roles,labels};
