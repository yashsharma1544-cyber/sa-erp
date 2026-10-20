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
