// Field app strings. Marathi is the default for field staff, with an English
// toggle. Customer-facing Marathi uses "टार्गेट", never "लक्ष्य".

export type Locale = "mr" | "en";

const strings = {
  appName: { mr: "SA ERP", en: "SA ERP" },
  chooseName: { mr: "तुमचे नाव निवडा", en: "Choose your name" },
  searchName: { mr: "नाव शोधा", en: "Search name" },
  enterPin: { mr: "४ अंकी पिन टाका", en: "Enter your 4-digit PIN" },
  signIn: { mr: "लॉगिन", en: "Sign in" },
  back: { mr: "मागे", en: "Back" },
  clear: { mr: "पुसा", en: "Clear" },
  wrongPin: { mr: "चुकीचा पिन. उरलेले प्रयत्न: {n}", en: "Wrong PIN. Attempts left: {n}" },
  locked: { mr: "खूप चुकीचे प्रयत्न. {time} नंतर पुन्हा प्रयत्न करा.", en: "Too many wrong tries. Try again after {time}." },
  unknownUser: { mr: "हा वापरकर्ता सापडला नाही. ऑफिसला संपर्क करा.", en: "User not found. Contact the office." },
  networkError: { mr: "नेटवर्क नाही. पुन्हा प्रयत्न करा.", en: "No network. Please try again." },
  hello: { mr: "नमस्कार, {name}", en: "Hello, {name}" },
  comingSoon: {
    mr: "तुमची आजची यादी आणि वसुली लवकरच येथे दिसेल.",
    en: "Your day list and collections will appear here soon.",
  },
  signOut: { mr: "लॉगआउट", en: "Sign out" },
  officeLogin: { mr: "ऑफिस लॉगिन (ईमेल)", en: "Office login (email)" },
  roles: { mr: "भूमिका", en: "Roles" },
  // Collector app
  collect: { mr: "वसुली", en: "Collections" },
  collectHint: { mr: "बीटनुसार थकबाकीची यादी, पैसे घ्या, वचन लिहा", en: "Beat-wise dues list, take payments, note promises" },
  chooseBeat: { mr: "बीट निवडा", en: "Choose a beat" },
  noBeats: { mr: "तुम्हाला अजून वसुलीचे बीट दिलेले नाही. ऑफिसला सांगा.", en: "No collection beats are assigned to you yet. Ask the office." },
  searchShop: { mr: "दुकान शोधा", en: "Search shop" },
  outstanding: { mr: "बाकी", en: "Due" },
  overdue: { mr: "थकीत", en: "Overdue" },
  oldestBill: { mr: "सर्वात जुने बिल", en: "Oldest bill" },
  daysAgo: { mr: "{n} दिवस", en: "{n} days" },
  lastPaid: { mr: "शेवटचा भरणा", en: "Last paid" },
  never: { mr: "कधीच नाही", en: "never" },
  nothingDue: { mr: "या बीटमध्ये कोणाची बाकी नाही.", en: "Nobody owes anything in this beat." },
  takePayment: { mr: "पैसे घेतले", en: "Took payment" },
  promise: { mr: "पैसे देण्याचे वचन", en: "Promise to pay" },
  notAvailable: { mr: "मालक भेटला नाही", en: "Owner not there" },
  refused: { mr: "पैसे देण्यास नकार", en: "Refused to pay" },
  shopClosed: { mr: "दुकान बंद", en: "Shop closed" },
  noteVisit: { mr: "भेटीची नोंद", en: "Note the visit" },
  firm: { mr: "फर्म", en: "Firm" },
  amount: { mr: "रक्कम (₹)", en: "Amount (₹)" },
  mode: { mr: "कसे दिले?", en: "Paid by" },
  cash: { mr: "रोख", en: "Cash" },
  upi: { mr: "UPI", en: "UPI" },
  cheque: { mr: "चेक", en: "Cheque" },
  upiRef: { mr: "UPI संदर्भ क्रमांक (UTR)", en: "UPI reference (UTR)" },
  chequeNo: { mr: "चेक नंबर", en: "Cheque number" },
  chequeDate: { mr: "चेकवरील तारीख", en: "Cheque date" },
  chequeBank: { mr: "बँकेचे नाव", en: "Bank" },
  chequePhoto: { mr: "चेकचा फोटो घ्या", en: "Take a photo of the cheque" },
  retakePhoto: { mr: "पुन्हा फोटो घ्या", en: "Retake photo" },
  promiseDate: { mr: "कधी देणार?", en: "Will pay on" },
  note: { mr: "टीप (ऐच्छिक)", en: "Note (optional)" },
  save: { mr: "सेव्ह करा", en: "Save" },
  cancel: { mr: "रद्द", en: "Cancel" },
  saved: { mr: "सेव्ह झाले. पावती क्र. {no}", en: "Saved. Receipt {no}" },
  savedPlain: { mr: "सेव्ह झाले", en: "Saved" },
  savedOffline: { mr: "नेटवर्क नाही. फोनमध्ये सेव्ह केले, नेटवर्क आल्यावर आपोआप पाठवले जाईल.", en: "No network. Saved on the phone; it will be sent when the network is back." },
  pendingSync: { mr: "{n} नोंदी पाठवायच्या बाकी", en: "{n} entries waiting to send" },
  failedSync: { mr: "{n} नोंदी नाकारल्या", en: "{n} entries were rejected" },
  syncNow: { mr: "आता पाठवा", en: "Send now" },
  remove: { mr: "काढून टाका", en: "Remove" },
  bills: { mr: "बाकी बिले", en: "Open bills" },
  olderDues: { mr: "जुनी बाकी (एप्रिल २०२५ पूर्वीची)", en: "Older dues (before April 2025)" },
  collectedSince: { mr: "आपण घेतलेले (टॅलीत यायचे बाकी): {amt}", en: "Collected by us, not in Tally yet: {amt}" },
  openPromise: { mr: "वचन: {date} रोजी {amt}", en: "Promised {amt} on {date}" },
  visitedToday: { mr: "आज भेट झाली", en: "Visited today" },
  offlineData: { mr: "ऑफलाइन – {time} ची माहिती", en: "Offline – data from {time}" },
  updatedAt: { mr: "अपडेट: {time}", en: "Updated {time}" },
  refresh: { mr: "रिफ्रेश", en: "Refresh" },
  today: { mr: "आज", en: "Today" },
  myToday: { mr: "आज मी घेतलेले", en: "My collections today" },
  call: { mr: "फोन", en: "Call" },
  enterAmount: { mr: "रक्कम टाका", en: "Enter the amount" },
  fillCheque: { mr: "चेकची सर्व माहिती आणि फोटो भरा", en: "Fill all cheque details and take the photo" },
  fillUpi: { mr: "UPI संदर्भ क्रमांक टाका", en: "Enter the UPI reference" },
  pickDate: { mr: "तारीख निवडा", en: "Pick a date" },
  moreThanDue: { mr: "रक्कम बाकीपेक्षा जास्त आहे. बरोबर आहे?", en: "This is more than the amount due. Is it right?" },
  language: { mr: "English", en: "मराठी" },
} as const;

export type StringKey = keyof typeof strings;

export function t(locale: Locale, key: StringKey, vars: Record<string, string | number> = {}): string {
  let s: string = strings[key][locale];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export const roleLabels: Record<string, { mr: string; en: string }> = {
  owner: { mr: "मालक", en: "Owner" },
  sales_admin: { mr: "सेल्स ॲडमिन", en: "Sales admin" },
  accounts: { mr: "अकाउंट्स", en: "Accounts" },
  stores: { mr: "स्टोअर्स", en: "Stores" },
  dispatch: { mr: "डिस्पॅच", en: "Dispatch" },
  driver: { mr: "ड्रायव्हर", en: "Driver" },
  salesman: { mr: "सेल्समन", en: "Salesman" },
  collector: { mr: "वसुली", en: "Collector" },
};

export function toLocale(value: string | undefined | null, fallback: Locale = "mr"): Locale {
  return value === "en" || value === "mr" ? value : fallback;
}
