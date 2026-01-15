#!/usr/bin/env node
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

const PAT = process.env.AIRTABLE_PAT;
const BASE = "appl6zLrRFDvsz0dh";
const TABLE = "tbltFEFUPMS6KZU8Y"; // Appointment Requests

async function main() {
  console.log("Fetching most recent Appointment Requests from Airtable...\n");

  // Search for Jaime Figueroa or leticiafigueroa email
  const url = `https://api.airtable.com/v0/${BASE}/${TABLE}?filterByFormula=OR(SEARCH("jaime",LOWER({First Name})),SEARCH("figueroa",LOWER({Last Name})),SEARCH("leticia",LOWER({Email})))`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${PAT}` }
  });

  const data = await response.json();

  if (data.error) {
    console.log("Error:", data.error);
    return;
  }

  console.log(`Found ${data.records.length} records:\n`);

  for (const r of data.records) {
    const f = r.fields;
    console.log("---");
    console.log("ID:", r.id);
    console.log("Name:", f["First Name"] || f["Name"], f["Last Name"] || "");
    console.log("Email:", f["Email"]);
    console.log("Phone:", f["Best phone number to reach you"]);
    console.log("Address:", f["Clean Address (Cats)"] || f["Clean Address"]);
    console.log("Status:", f["Status"]);
    console.log("Created:", r.createdTime);
    console.log("New Submitted:", f["New Submitted"]);
  }
}

main().catch(console.error);
