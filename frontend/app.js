function approveDefault() {
    console.log("approve default");
}

function reject() {
    console.log("reject");
}

function approveCustom() {
    const searchTerm = document.getElementById('searchTerm').value;

    console.log("custom approval:", {
        searchTerm
    });
}