/* Finance Careers affiliate slots (shared by index.html and pivot-product-management.html).
 *
 * HOW TO USE: fill in a real `url` for a slot once the affiliate program is
 * joined. Slots with an empty url render nothing and the FTC disclosure stays
 * hidden, so the page is compliant by construction. Never invent or guess
 * tracking URLs — only paste real links issued by the program.
 *
 * Candidate programs (not yet joined — apply first, then paste links here):
 *   cfa-prep       Kaplan Schweser, Wiley Efficient Learning (CFA)
 *   frm-prep       Kaplan Schweser, Wiley (FRM)
 *   pmp-prep       PMI Authorized Training Partners, Joseph Phillips (Udemy)
 *   data-analytics Google Data Analytics via Coursera, Coursera Plus
 *   ai-practitioner AWS Skill Builder, Udemy / Coursera AWS AI prep
 *   pspo-prep      Scrum.org courses, Mountain Goat / Mike Cohn prep
 */
window.FC_AFFILIATES = {
  "cfa-prep": {
    url: "",
    label: "CFA exam prep",
    blurb: "Structured prep for the CFA program exams — study planner, mock exams, and question banks from an established provider."
  },
  "frm-prep": {
    url: "",
    label: "FRM exam prep",
    blurb: "Targeted prep for the two-part FRM exams, with practice questions mapped to the GARP curriculum."
  },
  "pmp-prep": {
    url: "",
    label: "PMP / CAPM prep",
    blurb: "Exam prep aligned to the PMP and CAPM syllabi — contact hours, exam simulators, and study plans."
  },
  "data-analytics": {
    url: "",
    label: "Data analytics certificate prep",
    blurb: "Hands-on prep for data analytics certificates — SQL, spreadsheets, and analysis workflows."
  },
  "ai-practitioner": {
    url: "",
    label: "AWS AI Practitioner prep",
    blurb: "Prep for the AWS Certified AI Practitioner exam — ML concepts, generative AI, and responsible AI."
  },
  "pspo-prep": {
    url: "",
    label: "PSPO / Scrum prep",
    blurb: "Prep for the Professional Scrum Product Owner assessment — Scrum framework, backlog, and release planning."
  }
};

(function () {
  function esc(s) { return String(s).replace(/"/g, "&quot;"); }
  function render() {
    var cfg = window.FC_AFFILIATES || {};
    var anyActive = false;
    document.querySelectorAll("[data-aff]").forEach(function (el) {
      var slot = cfg[el.getAttribute("data-aff")];
      if (!slot || !slot.url) { el.style.display = "none"; return; }
      anyActive = true;
      el.innerHTML =
        '<div class="aff-card"><span class="aff-badge">Recommended prep</span>' +
        '<h4><a href="' + esc(slot.url) + '" target="_blank" rel="sponsored noopener nofollow">' + slot.label + "</a></h4>" +
        "<p>" + slot.blurb + "</p>" +
        '<p class="aff-cta"><a href="' + esc(slot.url) + '" target="_blank" rel="sponsored noopener nofollow">Compare plans &rarr;</a></p></div>';
    });
    if (anyActive) {
      document.querySelectorAll(".aff-disclosure").forEach(function (d) { d.hidden = false; });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
