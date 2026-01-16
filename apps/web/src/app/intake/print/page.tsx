"use client";

import { useState } from "react";
import { URGENT_SITUATION_EXAMPLES } from "@/lib/intake-options";

export default function PrintableIntakeForm() {
  const [includeKittenPage, setIncludeKittenPage] = useState(true);

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');

        @media print {
          @page { size: letter; margin: 0.3in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-controls { display: none !important; }
          .print-page {
            padding: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
          }
          .print-page:last-child { page-break-after: auto; }
        }

        body { margin: 0; padding: 0; }

        .print-wrapper {
          font-family: Helvetica, Arial, sans-serif;
          font-size: 9pt;
          line-height: 1.2;
          color: #2c3e50;
        }

        .print-page {
          width: 8.5in;
          height: 10.4in;
          padding: 0.3in;
          box-sizing: border-box;
          background: #fff;
        }

        h1, h2, h3, .section-title {
          font-family: 'Raleway', Helvetica, sans-serif;
          font-weight: 700;
        }

        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 6px;
          margin-bottom: 8px;
          border-bottom: 2px solid #3498db;
        }

        .print-header h1 {
          font-size: 14pt;
          margin: 0;
          color: #2c3e50;
        }

        .print-header .subtitle {
          font-size: 8pt;
          color: #7f8c8d;
          margin-top: 1px;
        }

        .header-logo {
          height: 36px;
          width: auto;
        }

        .intro-note {
          background: #e8f6f3;
          border-left: 3px solid #1abc9c;
          padding: 4px 8px;
          margin-bottom: 8px;
          font-size: 8pt;
          border-radius: 0 4px 4px 0;
        }

        .section {
          margin-bottom: 6px;
        }

        .section-title {
          font-size: 9pt;
          color: #3498db;
          border-bottom: 1px solid #ecf0f1;
          padding-bottom: 2px;
          margin-bottom: 4px;
        }

        .field-row {
          display: flex;
          gap: 8px;
          margin-bottom: 4px;
        }

        .field {
          flex: 1;
          min-width: 0;
        }

        .field.w2 { flex: 2; }
        .field.w3 { flex: 3; }
        .field.half { flex: 0.5; }

        .field label {
          display: block;
          font-size: 7pt;
          font-weight: 600;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.2px;
          margin-bottom: 1px;
        }

        .field-input {
          border: 1px solid #bdc3c7;
          border-radius: 3px;
          padding: 3px 5px;
          min-height: 18px;
          background: #fff;
        }

        .field-input.sm { min-height: 16px; padding: 2px 4px; }
        .field-input.lg { min-height: 50px; }
        .field-input.md { min-height: 32px; }

        .options-row {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 8pt;
          margin-bottom: 3px;
          flex-wrap: wrap;
        }

        .options-label {
          font-weight: 600;
          color: #2c3e50;
          min-width: 80px;
        }

        .option {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          margin-right: 8px;
        }

        .bubble {
          width: 10px;
          height: 10px;
          border: 1.5px solid #3498db;
          border-radius: 50%;
          background: #fff;
          flex-shrink: 0;
        }

        .checkbox {
          width: 10px;
          height: 10px;
          border: 1.5px solid #3498db;
          border-radius: 2px;
          background: #fff;
          flex-shrink: 0;
        }

        .hint {
          font-size: 7pt;
          color: #95a5a6;
          margin-left: 2px;
        }

        .third-party-box {
          border: 1.5px solid #f39c12;
          background: #fef9e7;
          padding: 6px 8px;
          margin-bottom: 8px;
          border-radius: 4px;
        }

        .third-party-box .title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          margin-bottom: 4px;
          color: #e67e22;
          font-size: 8pt;
        }

        .emergency-box {
          border: 1.5px solid #e74c3c;
          background: #fdedec;
          padding: 6px 8px;
          margin-bottom: 8px;
          border-radius: 4px;
        }

        .emergency-box .title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          color: #e74c3c;
          margin-bottom: 2px;
          font-size: 8pt;
        }

        .emergency-box .note {
          font-size: 7pt;
          color: #7f8c8d;
        }

        .info-card {
          background: #f8f9fa;
          border-radius: 4px;
          padding: 5px 8px;
          margin-bottom: 6px;
          border-left: 3px solid #3498db;
        }

        .staff-section {
          background: #f0f3f4;
          border: 1.5px dashed #bdc3c7;
          border-radius: 4px;
          padding: 6px 8px;
          margin-top: 6px;
        }

        .staff-section .section-title {
          color: #7f8c8d;
          border-bottom-color: #bdc3c7;
        }

        .signature-area {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid #ecf0f1;
        }

        .signature-area .consent {
          font-size: 7pt;
          color: #7f8c8d;
          max-width: 2.2in;
        }

        .signature-area .sig-fields {
          display: flex;
          gap: 16px;
          font-size: 8pt;
        }

        .footer {
          margin-top: auto;
          padding-top: 4px;
          font-size: 7pt;
          color: #95a5a6;
          text-align: center;
        }

        @media screen {
          body { background: #ecf0f1 !important; }
          .print-wrapper { padding: 20px; }
          .print-page {
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin: 0 auto 30px auto;
            border-radius: 8px;
            height: auto;
            min-height: 10in;
          }
          .print-controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 1000;
          }
          .print-controls h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #2c3e50;
          }
          .print-controls label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            font-size: 14px;
            cursor: pointer;
          }
          .print-controls input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #3498db;
          }
          .print-controls button {
            display: block;
            width: 100%;
            padding: 12px 20px;
            margin-bottom: 10px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s;
          }
          .print-controls .print-btn {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: #fff;
          }
          .print-controls .print-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(52,152,219,0.4);
          }
          .print-controls .back-btn {
            background: #f0f0f0;
            color: #333;
          }
        }
      `}</style>

      {/* Print Controls */}
      <div className="print-controls">
        <h3>Print Options</h3>
        <label>
          <input
            type="checkbox"
            checked={includeKittenPage}
            onChange={(e) => setIncludeKittenPage(e.target.checked)}
          />
          Include Kitten Page
        </label>
        <button className="print-btn" onClick={() => window.print()}>
          Print / Save PDF
        </button>
        <a href="/intake/queue" style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>← Back to Queue</button>
        </a>
      </div>

      {/* ==================== PAGE 1: Main Intake Form ==================== */}
      <div className="print-page">
        {/* Header */}
        <div className="print-header">
          <div>
            <h1>Help Request Form</h1>
            <div className="subtitle">Tell us about the cats that need help</div>
          </div>
          <img src="/logo.png" alt="Forgotten Felines" className="header-logo" />
        </div>

        {/* Intro Note */}
        <div className="intro-note">
          <strong>Thank you!</strong> Fill out completely. Fill bubbles: ● &nbsp;|&nbsp; <strong>Phone:</strong> (707) 576-7999 &nbsp;|&nbsp; <strong>Web:</strong> forgottenfelines.com
        </div>

        {/* Third-Party Report */}
        <div className="third-party-box">
          <div className="title">
            <span className="checkbox"></span>
            Reporting for someone else?
            <span className="hint">(neighbor, property manager)</span>
          </div>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <div className="field">
              <label>Relationship</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Property owner name</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Owner phone/email</label>
              <div className="field-input sm"></div>
            </div>
          </div>
        </div>

        {/* Section 1: Contact */}
        <div className="section">
          <div className="section-title">Your Contact Information</div>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <div className="field">
              <label>First Name *</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Last Name *</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field w2">
              <label>Email *</label>
              <div className="field-input sm"></div>
            </div>
          </div>
        </div>

        {/* Section 2: Location */}
        <div className="section">
          <div className="section-title">Where are the cats?</div>
          <div className="field-row">
            <div className="field w3">
              <label>Street Address *</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>City</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field half">
              <label>ZIP</label>
              <div className="field-input sm"></div>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "50px" }}>County:</span>
            <span className="option"><span className="bubble"></span> Sonoma</span>
            <span className="option"><span className="bubble"></span> Marin</span>
            <span className="option"><span className="bubble"></span> Napa</span>
            <span className="option"><span className="bubble"></span> Other: _____</span>
          </div>
        </div>

        {/* Section 3: About the Cats */}
        <div className="section">
          <div className="section-title">About the Cats</div>
          <div className="options-row">
            <span className="options-label" style={{ minWidth: "60px" }}>Type:</span>
            <span className="option"><span className="bubble"></span> Stray</span>
            <span className="option"><span className="bubble"></span> Community cat I feed</span>
            <span className="option"><span className="bubble"></span> New arrival</span>
            <span className="option"><span className="bubble"></span> Neighbor's</span>
            <span className="option"><span className="bubble"></span> My pet</span>
          </div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "2px" }}>
            <div className="field" style={{ flex: "0 0 90px" }}>
              <label>How many?</label>
              <div className="field-input sm" style={{ width: "50px" }}></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Eartipped?</span>
              <span className="option"><span className="bubble"></span> None</span>
              <span className="option"><span className="bubble"></span> Some</span>
              <span className="option"><span className="bubble"></span> Most/All</span>
              <span className="option"><span className="bubble"></span> Unknown</span>
            </div>
          </div>

          <div className="info-card" style={{ marginTop: "4px", marginBottom: "4px" }}>
            <div className="options-row" style={{ marginBottom: "1px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Feed them?</span>
              <span className="option"><span className="bubble"></span> Yes</span>
              <span className="option"><span className="bubble"></span> No</span>
              <span style={{ marginLeft: "8px", fontWeight: 600 }}>How often?</span>
              <span className="option"><span className="bubble"></span> Daily</span>
              <span className="option"><span className="bubble"></span> Few/wk</span>
              <span className="option"><span className="bubble"></span> Occasionally</span>
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "70px" }}>How long?</span>
              <span className="option"><span className="bubble"></span> &lt;2wks</span>
              <span className="option"><span className="bubble"></span> Weeks</span>
              <span className="option"><span className="bubble"></span> Months</span>
              <span className="option"><span className="bubble"></span> 1+yr</span>
              <span style={{ marginLeft: "8px", fontWeight: 600 }}>Inside?</span>
              <span className="option"><span className="bubble"></span> Yes</span>
              <span className="option"><span className="bubble"></span> Sometimes</span>
              <span className="option"><span className="bubble"></span> Never</span>
            </div>
          </div>

          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "70px" }}>Kittens?</span>
            <span className="option"><span className="bubble"></span> Yes</span>
            <span className="option"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "6px" }}>How many? ___</span>
            <span className="hint" style={{ marginLeft: "8px", color: "#3498db", fontWeight: 600 }}>
              If yes → Page 2
            </span>
          </div>
        </div>

        {/* Emergency */}
        <div className="emergency-box">
          <div className="title">
            <span className="checkbox"></span>
            Urgent situation
            <span className="hint">({URGENT_SITUATION_EXAMPLES})</span>
          </div>
          <div className="note">
            <strong>FFSC is NOT a 24hr hospital.</strong> Emergencies: <strong>Pet Care Hospital (707) 579-3900</strong>
            <span style={{ marginLeft: "8px" }}>
              <span className="checkbox" style={{ width: "8px", height: "8px", display: "inline-block", verticalAlign: "middle" }}></span>
              <span style={{ marginLeft: "2px" }}>Acknowledged</span>
            </span>
          </div>
        </div>

        {/* Section 4: Tell Us More + Situation Combined */}
        <div className="section">
          <div className="section-title">Additional Details</div>
          <div className="options-row" style={{ marginBottom: "2px" }}>
            <span className="option"><span className="checkbox"></span> Medical concerns</span>
            <span className="option"><span className="checkbox"></span> Property access OK</span>
            <span className="option"><span className="checkbox"></span> I'm owner</span>
            <span className="option"><span className="checkbox"></span> Others feeding</span>
            <span style={{ marginLeft: "12px", fontWeight: 600 }}>Heard from:</span>
            <span className="option"><span className="bubble"></span> Web</span>
            <span className="option"><span className="bubble"></span> Social</span>
            <span className="option"><span className="bubble"></span> Friend</span>
            <span className="option"><span className="bubble"></span> Vet</span>
          </div>
          <div style={{ fontSize: "7pt", color: "#7f8c8d", marginBottom: "3px" }}>
            Describe: cat colors/behavior, medical concerns, best contact times, where cats are seen, access notes
          </div>
          <div className="field-input lg"></div>
        </div>

        {/* Signature */}
        <div className="signature-area">
          <div className="consent">
            By submitting, you agree to be contacted by Forgotten Felines.
          </div>
          <div className="sig-fields">
            <span><strong>Date:</strong> __________</span>
            <span><strong>Signature:</strong> ________________________</span>
          </div>
        </div>

        {/* Staff Section */}
        <div className="staff-section">
          <div className="section-title">Office Use Only</div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "2px" }}>
            <div className="field" style={{ flex: "0 0 110px" }}>
              <label>Received</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field" style={{ flex: "0 0 110px" }}>
              <label>By</label>
              <div className="field-input sm"></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "45px" }}>Source:</span>
              <span className="option"><span className="bubble"></span> Phone</span>
              <span className="option"><span className="bubble"></span> Paper</span>
              <span className="option"><span className="bubble"></span> Walk-in</span>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "45px" }}>Priority:</span>
            <span className="option"><span className="bubble"></span> High</span>
            <span className="option"><span className="bubble"></span> Normal</span>
            <span className="option"><span className="bubble"></span> Low</span>
            <span style={{ marginLeft: "12px" }}><span className="options-label" style={{ minWidth: "45px" }}>Triage:</span></span>
            <span className="option"><span className="bubble"></span> FFR</span>
            <span className="option"><span className="bubble"></span> Wellness</span>
            <span className="option"><span className="bubble"></span> Owned</span>
            <span className="option"><span className="bubble"></span> Out of area</span>
            <span className="option"><span className="bubble"></span> Review</span>
          </div>
        </div>
      </div>

      {/* ==================== PAGE 2: Kitten Details ==================== */}
      {includeKittenPage && (
        <div className="print-page">
          {/* Header */}
          <div className="print-header">
            <div>
              <h1>Kitten Details</h1>
              <div className="subtitle">Complete if kittens are present</div>
            </div>
            <img src="/logo.png" alt="Forgotten Felines" className="header-logo" />
          </div>

          <div className="field-row" style={{ marginBottom: "8px" }}>
            <div className="field w2">
              <label>Requester Name (from page 1)</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className="field-input sm"></div>
            </div>
          </div>

          {/* Kitten Info */}
          <div className="section">
            <div className="section-title">Kitten Information</div>

            <div className="field-row" style={{ alignItems: "center", marginBottom: "2px" }}>
              <div className="field" style={{ flex: "0 0 100px" }}>
                <label>How many?</label>
                <div className="field-input sm" style={{ width: "50px" }}></div>
              </div>
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "50px" }}>Age:</span>
                <span className="option"><span className="bubble"></span> &lt;4wk</span>
                <span className="option"><span className="bubble"></span> 4-8wk</span>
                <span className="option"><span className="bubble"></span> 8-12wk</span>
                <span className="option"><span className="bubble"></span> 12-16wk</span>
                <span className="option"><span className="bubble"></span> 4+mo</span>
                <span className="option"><span className="bubble"></span> Mixed</span>
              </div>
            </div>

            <div className="field" style={{ marginTop: "4px", marginBottom: "4px" }}>
              <label>If mixed ages, describe (e.g., "3 at 8 weeks, 2 at 5 months")</label>
              <div className="field-input sm"></div>
            </div>

            <div className="options-row">
              <span className="options-label" style={{ minWidth: "60px" }}>Behavior:</span>
              <span className="option"><span className="bubble"></span> Friendly</span>
              <span className="option"><span className="bubble"></span> Shy/handleable</span>
              <span className="option"><span className="bubble"></span> Hissy (young)</span>
              <span className="option"><span className="bubble"></span> Unhandleable</span>
              <span className="option"><span className="bubble"></span> Unknown</span>
            </div>

            <div className="info-card" style={{ marginTop: "4px", marginBottom: "4px" }}>
              <div className="options-row" style={{ marginBottom: "1px" }}>
                <span className="options-label" style={{ minWidth: "60px" }}>Contained?</span>
                <span className="option"><span className="bubble"></span> All caught</span>
                <span className="option"><span className="bubble"></span> Some</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span style={{ marginLeft: "12px" }}><span className="options-label" style={{ minWidth: "70px" }}>Mom there?</span></span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Unsure</span>
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "60px" }}>Mom fixed?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Unsure</span>
                <span style={{ marginLeft: "12px" }}><span className="options-label" style={{ minWidth: "70px" }}>Bring in?</span></span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> Need help</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
            </div>

            <div className="field" style={{ marginTop: "4px" }}>
              <label>Kitten details (colors, hiding spots, feeding times, trap-savvy)</label>
              <div className="field-input md"></div>
            </div>
          </div>

          {/* Foster Program Info - Compact */}
          <div style={{ background: "#e8f6f3", borderLeft: "3px solid #1abc9c", padding: "6px 8px", borderRadius: "0 4px 4px 0", marginBottom: "8px" }}>
            <strong style={{ color: "#16a085", fontSize: "8pt" }}>About Our Foster Program</strong>
            <div style={{ fontSize: "7pt", lineHeight: "1.4", marginTop: "2px" }}>
              <strong>Age:</strong> Under 12wk ideal • 12-16wk needs intensive work •
              <strong> Behavior:</strong> Friendly/handleable prioritized •
              <strong> Mom:</strong> Spayed mom helps •
              Older/feral kittens (12+wk, hard to handle) may need FFR instead •
              <strong> Space limited</strong> - placement not guaranteed until assessment
            </div>
          </div>

          {/* Staff Section */}
          <div className="staff-section">
            <div className="section-title">Kitten Assessment (Office Use)</div>

            <div className="field-row" style={{ alignItems: "center", marginBottom: "4px" }}>
              <div className="field" style={{ flex: "0 0 140px" }}>
                <label>Assessment by</label>
                <div className="field-input sm"></div>
              </div>
              <div className="field" style={{ flex: "0 0 100px" }}>
                <label>Date</label>
                <div className="field-input sm"></div>
              </div>
            </div>

            <div className="options-row">
              <span className="options-label" style={{ minWidth: "60px" }}>Outcome:</span>
              <span className="option"><span className="bubble"></span> Foster intake</span>
              <span className="option"><span className="bubble"></span> FFR candidate</span>
              <span className="option"><span className="bubble"></span> Pending</span>
              <span className="option"><span className="bubble"></span> Declined</span>
            </div>

            <div className="options-row">
              <span className="options-label" style={{ minWidth: "60px" }}>Readiness:</span>
              <span className="option"><span className="bubble"></span> High (friendly, ideal age)</span>
              <span className="option"><span className="bubble"></span> Medium (needs work)</span>
              <span className="option"><span className="bubble"></span> Low (FFR likely)</span>
            </div>

            <div className="options-row">
              <span className="options-label" style={{ minWidth: "60px" }}>Urgency:</span>
              <span className="option"><span className="checkbox"></span> Bottle babies</span>
              <span className="option"><span className="checkbox"></span> Medical</span>
              <span className="option"><span className="checkbox"></span> Unsafe location</span>
              <span className="option"><span className="checkbox"></span> Mom unfixed</span>
            </div>

            <div className="field" style={{ marginTop: "4px" }}>
              <label>Staff notes (foster contact, follow-up, trapping plan)</label>
              <div className="field-input md"></div>
            </div>
          </div>

          <div className="footer">
            Forgotten Felines of Sonoma County • Helping community cats since 1990 • Page 2
          </div>
        </div>
      )}
    </div>
  );
}
