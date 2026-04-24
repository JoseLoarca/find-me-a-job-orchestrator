const API_URL = window.APP_CONFIG?.API_URL;

let requestId = null;
let isSubmitting = false;

// Initialize script
function getRequestIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("requestId");
}

function init() {
    requestId = getRequestIdFromUrl();

    if (requestId) {
        // remove from URL for safety
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (!requestId) {
        showError("Invalid or missing request");
        return;
    }

    console.log("Request loaded:", requestId.slice(0, 8) + "...");
}

init();

// Message display
function showSuccess(message) {
    document.getElementById("app").style.display = "none";
    document.getElementById("status").innerHTML = `<h2>${message}</h2>`;
}

function showError(message) {
    document.getElementById("app").style.display = "none";
    document.getElementById("status").innerHTML = `<h2 style="color:red;">${message}</h2>`;
}

function disableButtons() {
    document.querySelectorAll("button").forEach(btn => {
        btn.disabled = true;
    });
}

// API Gateway call
async function sendDecision(decision, payload = {}) {
    if (!requestId) {
        showError("Invalid request");
        return;
    }

    if (isSubmitting) return;
    isSubmitting = true;

    disableButtons();

    try {
        const res = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                requestId,
                decision,
                payload
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || "Request failed");
        }

        showSuccess(`${decision} successful`);
    } catch (err) {
        console.error(err);
        showError(err.message || "Something went wrong");
        isSubmitting = false; // allow retry
    }
}


function approveDefault() {
    console.log("Approve");
    sendDecision("APPROVE");
}

function reject() {
    console.log("Reject");
    sendDecision("REJECT");
}

function approveCustom() {
    console.log("Custom approval")
    const searchTerm = document.getElementById('searchTerm').value;

    sendDecision("APPROVE", {
        searchTerm
    });
}