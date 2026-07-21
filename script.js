const API_URL =
    "https://script.google.com/macros/s/AKfycbwh6IAUczu3L2XKoSTz4YjBrPZYGmxJhqP4iMFu_EHNK8YlJn5wmwSah4k1vLCMCjZz6Q/exec";


// =====================================================
// GLOBAL DATA
// =====================================================

let devices = [];
let currentArea = "All";

let pingLogs = {};

const MAX_LOGS_PER_DEVICE = 100;

let devicesCurrentlyChecking = {};

let monitoringTimer = null;


// =====================================================
// MONITORING SETTINGS
// =====================================================

// 30 minutes
const PING_INTERVAL = 30 * 60 * 1000;


// =====================================================
// LOAD DEVICES
// =====================================================

function loadDevices() {

    callAPI(

        API_URL +
        "?action=getDevices",

        function(response) {

            if (
                !response ||
                !response.success
            ) {

                console.error(
                    response?.message ||
                    "Failed to load devices"
                );

                return;

            }


            const oldDeviceStates = {};


            devices.forEach(function(device) {

                oldDeviceStates[
                    String(device.id)
                ] = {

                    status:
                        device.status,

                    lastChecked:
                        device.lastChecked,

                    responseTime:
                        device.responseTime,

                    offlineCount:
                        device.offlineCount,

                    firstOffline:
                        device.firstOffline,

                    lastOffline:
                        device.lastOffline

                };

            });


            devices =
                response.devices ||
                [];


            devices.forEach(function(device) {

                const oldState =
                    oldDeviceStates[
                        String(device.id)
                    ];


                if (oldState) {

                    device.status =
                        oldState.status;

                    device.lastChecked =
                        oldState.lastChecked;

                    device.responseTime =
                        oldState.responseTime;

                    device.offlineCount =
                        oldState.offlineCount;

                    device.firstOffline =
                        oldState.firstOffline;

                    device.lastOffline =
                        oldState.lastOffline;

                }


                if (
                    !pingLogs[device.id]
                ) {

                    pingLogs[device.id] =
                        [];

                }

            });


            displayDevices();

            updateStatistics();

            updateConnectionStatus(true);


            const lastUpdated =
                document.getElementById(
                    "lastUpdated"
                );


            if (lastUpdated) {

                lastUpdated.textContent =
                    "Last updated: " +
                    new Date()
                        .toLocaleTimeString();

            }


            // Check immediately when page loads
            checkAllDevices();

        }

    );

}


// =====================================================
// CHECK ALL DEVICES
// =====================================================

function checkAllDevices() {

    if (
        !devices ||
        devices.length === 0
    ) {

        return;

    }


    devices.forEach(function(device) {

        checkDevice(
            device,
            "Automatic"
        );

    });

}


// =====================================================
// FORCE PING
// =====================================================

function forcePing(id) {

    const device =
        devices.find(function(device) {

            return String(device.id) ===
                String(id);

        });


    if (!device) {

        return;

    }


    if (
        devicesCurrentlyChecking[
            String(device.id)
        ]
    ) {

        alert(
            "This device is already being checked."
        );

        return;

    }


    // Show Checking immediately
    device.status =
        "Checking";

    device.responseTime =
        null;

    device.lastChecked =
        "Checking now...";


    displayDevices();

    updateStatistics();


    // Perform immediate force ping
    checkDevice(
        device,
        "Force"
    );

}


// =====================================================
// CHECK ONE DEVICE
// =====================================================

function checkDevice(

    device,

    pingType = "Automatic"

) {

    if (
        !device ||
        !device.ip
    ) {

        return;

    }


    const deviceId =
        String(device.id);


    if (
        devicesCurrentlyChecking[
            deviceId
        ]
    ) {

        return;

    }


    devicesCurrentlyChecking[
        deviceId
    ] = true;


    const oldStatus =
        device.status;


    const startTime =
        performance.now();


    const controller =
        new AbortController();


    const timeout =
        setTimeout(function() {

            controller.abort();

        }, 3000);


    fetch(

        "http://" +
        device.ip +
        "/",

        {

            method:
                "GET",

            mode:
                "no-cors",

            cache:
                "no-store",

            signal:
                controller.signal

        }

    )


    // =========================
    // ONLINE
    // =========================

    .then(function() {

        clearTimeout(
            timeout
        );


        const responseTime =
            Math.round(

                performance.now() -
                startTime

            );


        updateDeviceStatus(

            device,

            "Online",

            responseTime,

            pingType

        );

    })


    // =========================
    // OFFLINE
    // =========================

    .catch(function() {

        clearTimeout(
            timeout
        );


        updateDeviceStatus(

            device,

            "Offline",

            null,

            pingType

        );

    });

}


// =====================================================
// UPDATE DEVICE STATUS
// =====================================================

function updateDeviceStatus(

    device,

    status,

    responseTime,

    pingType

) {

    const deviceId =
        String(device.id);


    const oldStatus =
        device.status;


    const now =
        new Date();


    const timestamp =
        now.toLocaleString();


    device.status =
        status;


    device.lastChecked =
        timestamp;


    device.responseTime =
        responseTime;


    // =================================================
    // ONLINE
    // =================================================

    if (
        status === "Online"
    ) {

        // If previously offline,
        // this is a RECOVERY
        if (
            oldStatus === "Offline"
        ) {

            saveLogToSheet(

                device,

                "RECOVERED",

                responseTime,

                pingType

            );

        }


        device.offlineCount =
            device.offlineCount ||
            0;

    }


    // =================================================
    // OFFLINE
    // =================================================

    if (
        status === "Offline"
    ) {


        // Count offline event
        device.offlineCount =
            (
                device.offlineCount ||
                0
            ) + 1;


        // First time this device went offline
        if (
            !device.firstOffline ||
            oldStatus !== "Offline"
        ) {

            device.firstOffline =
                timestamp;

        }


        device.lastOffline =
            timestamp;


        // Save automatic offline event
        saveLogToSheet(

            device,

            "Offline",

            null,

            pingType

        );

    }


    // =================================================
    // ONLINE LOGGING
    // =================================================

    if (
        status === "Online"
    ) {

        saveLogToSheet(

            device,

            "Online",

            responseTime,

            pingType

        );

    }


    devicesCurrentlyChecking[
        deviceId
    ] = false;


    // Add local log
    addPingLog(

        device,

        status,

        responseTime,

        pingType

    );


    displayDevices();

    updateStatistics();

}


// =====================================================
// LOCAL PING LOG
// =====================================================

function addPingLog(

    device,

    status,

    responseTime,

    pingType

) {

    const deviceId =
        String(device.id);


    if (
        !pingLogs[deviceId]
    ) {

        pingLogs[deviceId] =
            [];

    }


    const time =
        new Date()
            .toLocaleString();


    let message;


    if (
        status === "Online"
    ) {

        message =
            "Reply from " +
            device.ip +
            ": time=" +
            responseTime +
            "ms";

    }

    else if (
        status === "Offline"
    ) {

        message =
            "Request timed out. Router may be offline or unreachable.";

    }

    else if (
        status === "Recovered"
    ) {

        message =
            "Router recovered and is responding again.";

    }


    pingLogs[deviceId].push({

        time:
            time,

        status:
            status.toUpperCase(),

        type:
            pingType,

        message:
            message,

        responseTime:
            responseTime

    });


    if (

        pingLogs[deviceId].length >
        MAX_LOGS_PER_DEVICE

    ) {

        pingLogs[deviceId].shift();

    }

}


// =====================================================
// SAVE LOG TO GOOGLE SHEETS
// SHEET: IP-LOGS
// =====================================================

function saveLogToSheet(

    device,

    status,

    responseTime,

    pingType

) {


    const url =

        API_URL +

        "?action=savePingLog" +

        "&deviceId=" +

        encodeURIComponent(
            device.id
        ) +

        "&deviceName=" +

        encodeURIComponent(
            device.name
        ) +

        "&ip=" +

        encodeURIComponent(
            device.ip
        ) +

        "&area=" +

        encodeURIComponent(
            device.area
        ) +

        "&status=" +

        encodeURIComponent(
            status
        ) +

        "&responseTime=" +

        encodeURIComponent(
            responseTime || ""
        ) +

        "&pingType=" +

        encodeURIComponent(
            pingType
        );


    callAPI(

        url,

        function(response) {

            if (
                !response ||
                !response.success
            ) {

                console.error(

                    "Failed to save ping log:",

                    response?.message

                );

            }

        }

    );

}


// =====================================================
// VIEW LOGS
// =====================================================

function viewLogs(id) {


    const device =
        devices.find(function(device) {

            return String(device.id) ===
                String(id);

        });


    if (!device) {

        return;

    }


    closeLogs();


    const logWindow =
        document.createElement(
            "div"
        );


    logWindow.className =
        "ping-log-window";


    logWindow.innerHTML = `

        <div class="ping-log-header">

            <h2>

                Ping Logs -

                ${escapeHTML(
                    device.name
                )}

            </h2>


            <button
                onclick="closeLogs()"
            >

                ×

            </button>

        </div>


        <div class="ping-log-info">

            <div>

                IP:

                <strong>

                    ${escapeHTML(
                        device.ip
                    )}

                </strong>

            </div>


            <div>

                Area / Floor:

                <strong>

                    ${escapeHTML(
                        device.area
                    )}

                </strong>

            </div>


            <div>

                Current Status:

                <strong>

                    ${escapeHTML(
                        device.status ||
                        "Unknown"
                    )}

                </strong>

            </div>


            <div>

                Offline Count:

                <strong>

                    ${
                        device.offlineCount ||
                        0
                    }

                </strong>

            </div>

        </div>


        <pre
            id="logContent"
            class="ping-log-content"
        ></pre>


        <div class="ping-log-footer">


            <button
                onclick="forcePing('${device.id}')"
            >

                Force Ping

            </button>


            <button
                onclick="clearDeviceLogs('${device.id}')"
            >

                Clear Local Logs

            </button>


            <button
                onclick="closeLogs()"
            >

                Close

            </button>


        </div>

    `;


    document.body.appendChild(
        logWindow
    );


    window.currentLogDeviceId =
        id;


    refreshLogWindow(
        id
    );


    window.logRefreshInterval =
        setInterval(function() {

            refreshLogWindow(
                id
            );

        }, 1000);

}


// =====================================================
// REFRESH LOG WINDOW
// =====================================================

function refreshLogWindow(id) {


    const content =
        document.getElementById(
            "logContent"
        );


    if (!content) {

        return;

    }


    const logs =
        pingLogs[id] ||
        [];


    let logText =
        "";


    if (
        logs.length === 0
    ) {

        logText =
            "No ping logs yet.";

    }

    else {


        logs.forEach(function(log) {


            logText +=

                "[" +

                log.time +

                "] [" +

                log.type +

                "] " +

                log.message +

                "\n";


        });

    }


    content.textContent =
        logText;


    content.scrollTop =
        content.scrollHeight;

}


// =====================================================
// OFFLINE REPORT
// =====================================================

function viewOfflineReport() {


    closeLogs();


    const offlineDevices =
        devices.filter(function(device) {


            return (

                device.status ===
                "Offline"

                ||

                device.offlineCount >
                0

            );


        });


    const reportWindow =
        document.createElement(
            "div"
        );


    reportWindow.className =
        "ping-log-window";


    let reportHTML = `

        <div class="ping-log-header">

            <h2>

                Router Offline Report

            </h2>


            <button
                onclick="closeLogs()"
            >

                ×

            </button>

        </div>


        <div class="ping-log-info">

            Automatic report from

            <strong>

                30-minute monitoring checks

            </strong>

        </div>


        <div
            class="offline-report-table"
        >

            <table>

                <thead>

                    <tr>

                        <th>
                            Device
                        </th>

                        <th>
                            IP Address
                        </th>

                        <th>
                            Area / Floor
                        </th>

                        <th>
                            Current Status
                        </th>

                        <th>
                            Failure Count
                        </th>

                        <th>
                            First Offline
                        </th>

                        <th>
                            Last Offline
                        </th>

                    </tr>

                </thead>

                <tbody>

    `;


    if (
        offlineDevices.length === 0
    ) {

        reportHTML += `

            <tr>

                <td
                    colspan="7"
                    style="text-align:center"
                >

                    No offline devices recorded.

                </td>

            </tr>

        `;

    }

    else {


        offlineDevices.forEach(function(device) {


            reportHTML += `

                <tr>

                    <td>

                        ${escapeHTML(
                            device.name
                        )}

                    </td>


                    <td>

                        ${escapeHTML(
                            device.ip
                        )}

                    </td>


                    <td>

                        ${escapeHTML(
                            device.area
                        )}

                    </td>


                    <td>

                        ${escapeHTML(
                            device.status ||
                            "Unknown"
                        )}

                    </td>


                    <td>

                        ${
                            device.offlineCount ||
                            0
                        }

                    </td>


                    <td>

                        ${
                            device.firstOffline ||
                            "-"
                        }

                    </td>


                    <td>

                        ${
                            device.lastOffline ||
                            "-"
                        }

                    </td>

                </tr>

            `;

        });

    }


    reportHTML += `

                </tbody>

            </table>

        </div>


        <div class="ping-log-footer">

            <button
                onclick="closeLogs()"
            >

                Close

            </button>

        </div>

    `;


    reportWindow.innerHTML =
        reportHTML;


    document.body.appendChild(
        reportWindow
    );

}


// =====================================================
// CLOSE LOG WINDOW
// =====================================================

function closeLogs() {


    document
        .querySelector(
            ".ping-log-window"
        )
        ?.remove();


    if (
        window.logRefreshInterval
    ) {

        clearInterval(
            window.logRefreshInterval
        );

        window.logRefreshInterval =
            null;

    }


    window.currentLogDeviceId =
        null;

}


// =====================================================
// CLEAR LOCAL LOGS
// =====================================================

function clearDeviceLogs(id) {


    pingLogs[id] =
        [];


    refreshLogWindow(
        id
    );

}


// =====================================================
// DISPLAY DEVICES
// =====================================================

function displayDevices() {


    const table =
        document.getElementById(
            "deviceTable"
        );


    const emptyMessage =
        document.getElementById(
            "emptyMessage"
        );


    if (!table) {

        return;

    }


    const searchInput =
        document.getElementById(
            "searchInput"
        );


    const statusFilterInput =
        document.getElementById(
            "statusFilter"
        );


    const search =
        searchInput
            ? searchInput.value.toLowerCase()
            : "";


    const statusFilter =
        statusFilterInput
            ? statusFilterInput.value
            : "All";


    const filteredDevices =
        devices.filter(function(device) {


            const text =

                String(
                    device.name ||
                    ""
                )

                + " " +

                String(
                    device.ip ||
                    ""
                )

                + " " +

                String(
                    device.area ||
                    ""
                );


            const matchesSearch =
                text
                    .toLowerCase()
                    .includes(search);


            const matchesArea =

                currentArea ===
                "All"

                ||

                device.area ===
                currentArea;


            const matchesStatus =

                statusFilter ===
                "All"

                ||

                device.status ===
                statusFilter;


            return (

                matchesSearch &&

                matchesArea &&

                matchesStatus

            );

        });


    if (
        filteredDevices.length === 0
    ) {

        table.innerHTML =
            "";


        if (
            emptyMessage
        ) {

            emptyMessage.style.display =
                "block";

        }


        return;

    }


    if (
        emptyMessage
    ) {

        emptyMessage.style.display =
            "none";

    }


    table.innerHTML =
        "";


    filteredDevices.forEach(function(device) {


        let statusClass =
            String(
                device.status ||
                "Unknown"
            )
            .toLowerCase();


        if (

            statusClass !==
            "online"

            &&

            statusClass !==
            "offline"

            &&

            statusClass !==
            "checking"

        ) {

            statusClass =
                "unknown";

        }


        let statusText =
            device.status ||
            "Unknown";


        // Add response time beside Online
        if (

            device.status ===
            "Online"

            &&

            device.responseTime !==
            null

            &&

            device.responseTime !==
            undefined

        ) {

            statusText +=
                " " +
                device.responseTime +
                "ms";

        }


        const row =
            document.createElement(
                "tr"
            );


        row.innerHTML = `


            <td>

                <div
                    class="device-name"
                >

                    ${escapeHTML(
                        device.name
                    )}

                </div>

            </td>


            <td>

                <div
                    class="ip-address"
                >

                    ${escapeHTML(
                        device.ip
                    )}

                </div>

            </td>


            <td>

                ${escapeHTML(
                    device.area
                )}

            </td>


            <td>

                <span
                    class="status-badge
                    ${statusClass}"
                >

                    ●

                    ${escapeHTML(
                        statusText
                    )}

                </span>

            </td>


            <td>

                ${formatDate(
                    device.lastChecked
                )}

            </td>


            <td>


                <button

                    class="action-button
                    status-button"

                    onclick=
                    "forcePing(
                        '${device.id}'
                    )"

                >

                    Force Ping

                </button>


                <button

                    class="action-button
                    status-button"

                    onclick=
                    "viewLogs(
                        '${device.id}'
                    )"

                >

                    View Logs

                </button>


                <button

                    class="action-button
                    status-button"

                    onclick=
                    "changeStatus(
                        '${device.id}'
                    )"

                >

                    Status

                </button>


                <button

                    class="action-button
                    edit-button"

                    onclick=
                    "openEditModal(
                        '${device.id}'
                    )"

                >

                    Edit

                </button>


                <button

                    class="action-button
                    delete-button"

                    onclick=
                    "deleteDevice(
                        '${device.id}'
                    )"

                >

                    Delete

                </button>


            </td>


        `;


        table.appendChild(
            row
        );


    });

}


// =====================================================
// STATISTICS
// =====================================================

function updateStatistics() {


    const totalDevices =
        document.getElementById(
            "totalDevices"
        );


    const onlineDevices =
        document.getElementById(
            "onlineDevices"
        );


    const offlineDevices =
        document.getElementById(
            "offlineDevices"
        );


    const unknownDevices =
        document.getElementById(
            "unknownDevices"
        );


    const online =
        devices.filter(function(device) {

            return device.status ===
                "Online";

        }).length;


    const offline =
        devices.filter(function(device) {

            return device.status ===
                "Offline";

        }).length;


    const checking =
        devices.filter(function(device) {

            return device.status ===
                "Checking";

        }).length;


    const unknown =
        devices.filter(function(device) {

            return (

                device.status !==
                "Online"

                &&

                device.status !==
                "Offline"

                &&

                device.status !==
                "Checking"

            );

        }).length;


    if (
        totalDevices
    ) {

        totalDevices.textContent =
            devices.length;

    }


    if (
        onlineDevices
    ) {

        onlineDevices.textContent =
            online;

    }


    if (
        offlineDevices
    ) {

        offlineDevices.textContent =
            offline;

    }


    if (
        unknownDevices
    ) {

        unknownDevices.textContent =
            unknown +
            checking;

    }

}


// =====================================================
// GOOGLE SHEETS API
// =====================================================

function callAPI(

    url,

    successCallback

) {


    const callbackName =

        "callback_" +

        Date.now() +

        "_" +

        Math.random()
            .toString(36)
            .substring(2);


    const script =
        document.createElement(
            "script"
        );


    window[callbackName] =
        function(response) {


            successCallback(
                response
            );


            delete window[
                callbackName
            ];


            if (
                script.parentNode
            ) {

                script.parentNode
                    .removeChild(
                        script
                    );

            }

        };


    script.src =

        url +

        "&callback=" +

        callbackName;


    script.onerror =
        function() {


            console.error(
                "API connection failed"
            );


            delete window[
                callbackName
            ];


            if (
                script.parentNode
            ) {

                script.parentNode
                    .removeChild(
                        script
                    );

            }

        };


    document.body.appendChild(
        script
    );

}


// =====================================================
// CONNECTION STATUS
// =====================================================

function updateConnectionStatus(
    connected
) {


    const status =
        document.getElementById(
            "connectionStatus"
        );


    if (!status) {

        return;

    }


    status.innerHTML =
        connected
            ? "● Connected"
            : "● Connection Failed";


    status.style.color =
        connected
            ? "#16a34a"
            : "#dc2626";

}


// =====================================================
// AREA FILTER
// =====================================================

function filterByArea(area) {

    currentArea =
        area;


    displayDevices();

}


function showAllDevices() {

    currentArea =
        "All";


    displayDevices();

}


// =====================================================
// DATE FORMAT
// =====================================================

function formatDate(date) {

    return date ||
        "-";

}


// =====================================================
// SECURITY
// =====================================================

function escapeHTML(value) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        value == null
            ? ""
            : value;


    return div.innerHTML;

}


// =====================================================
// YOUR EXISTING ADD / EDIT / DELETE FUNCTIONS
// =====================================================

function openAddModal() {

    document.getElementById(
        "modalTitle"
    ).textContent =
        "Add Device";


    document.getElementById(
        "deviceId"
    ).value =
        "";


    document.getElementById(
        "deviceName"
    ).value =
        "";


    document.getElementById(
        "deviceIP"
    ).value =
        "";


    document.getElementById(
        "deviceArea"
    ).value =
        "";


    document.getElementById(
        "deviceModal"
    ).classList.add(
        "show"
    );

}


function openEditModal(id) {

    const device =
        devices.find(function(device) {

            return String(device.id) ===
                String(id);

        });


    if (!device) {

        return;

    }


    document.getElementById(
        "modalTitle"
    ).textContent =
        "Edit Device";


    document.getElementById(
        "deviceId"
    ).value =
        device.id;


    document.getElementById(
        "deviceName"
    ).value =
        device.name;


    document.getElementById(
        "deviceIP"
    ).value =
        device.ip;


    document.getElementById(
        "deviceArea"
    ).value =
        device.area;


    document.getElementById(
        "deviceModal"
    ).classList.add(
        "show"
    );

}


function closeModal() {

    document.getElementById(
        "deviceModal"
    ).classList.remove(
        "show"
    );

}


function saveDevice(event) {

    event.preventDefault();


    const id =
        document.getElementById(
            "deviceId"
        ).value;


    const name =
        document.getElementById(
            "deviceName"
        ).value;


    const ip =
        document.getElementById(
            "deviceIP"
        ).value;


    const area =
        document.getElementById(
            "deviceArea"
        ).value;


    const action =
        id
            ? "updateDevice"
            : "addDevice";


    let finalURL =

        API_URL +

        "?action=" +

        action +

        "&name=" +

        encodeURIComponent(
            name
        ) +

        "&ip=" +

        encodeURIComponent(
            ip
        ) +

        "&area=" +

        encodeURIComponent(
            area
        );


    if (id) {

        finalURL +=

            "&id=" +

            encodeURIComponent(
                id
            );

    }


    callAPI(

        finalURL,

        function(response) {


            alert(
                response.message
            );


            if (
                response.success
            ) {

                closeModal();

                loadDevices();

            }

        }

    );

}


function deleteDevice(id) {

    const device =
        devices.find(function(device) {

            return String(device.id) ===
                String(id);

        });


    if (!device) {

        return;

    }


    if (
        !confirm(
            "Delete " +
            device.name +
            "?"
        )
    ) {

        return;

    }


    callAPI(

        API_URL +

        "?action=deleteDevice" +

        "&id=" +

        encodeURIComponent(
            id
        ),

        function(response) {


            alert(
                response.message
            );


            if (
                response.success
            ) {

                delete pingLogs[id];

                delete devicesCurrentlyChecking[id];

                loadDevices();

            }

        }

    );

}


function changeStatus(id) {

    const device =
        devices.find(function(device) {

            return String(device.id) ===
                String(id);

        });


    if (!device) {

        return;

    }


    const status =
        prompt(

            "Enter status:\n\n" +

            "Online\n" +

            "Offline\n" +

            "Unknown",

            device.status

        );


    if (!status) {

        return;

    }


    const formattedStatus =

        status.charAt(0)
            .toUpperCase() +

        status.slice(1)
            .toLowerCase();


    callAPI(

        API_URL +

        "?action=updateStatus" +

        "&id=" +

        encodeURIComponent(
            id
        ) +

        "&status=" +

        encodeURIComponent(
            formattedStatus
        ),

        function(response) {


            alert(
                response.message
            );


            if (
                response.success
            ) {

                loadDevices();

            }

        }

    );

}


// =====================================================
// AUTOMATIC MONITORING
// =====================================================

monitoringTimer =
    setInterval(

        function() {

            checkAllDevices();

        },

        PING_INTERVAL

    );


// =====================================================
// INITIAL LOAD
// =====================================================

loadDevices();