/**
 * The allowed values for the academic profile fields.
 *
 * These mirror backend/edtech/utils/studentProfile.js, which is the authority —
 * the server rejects anything outside its own lists. Duplicating them here
 * keeps the form usable without a round trip on first paint; if the two ever
 * disagree, the symptom is a dropdown option that fails validation on submit,
 * so change both together.
 */

export const CLASS_LEVELS = ['10th', '11th', '12th', 'NEET', 'JEE'];

export const BOARDS = ['HP Board', 'CBSE', 'Other'];

export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
];
