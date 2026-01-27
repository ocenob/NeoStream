const si = require('systeminformation');
const os = require('os');

console.log('--- System Information Debug ---');
console.log('OS Platform:', os.platform());
console.log('OS Release:', os.release());
console.log('CPU Cores:', os.cpus().length);

async function checkCPU() {
    try {
        console.log('\nReading CPU Load (Wait 5 seconds)...');
        const cpuData = await si.currentLoad();
        console.log('--- Raw Data from systeminformation ---');
        console.log(JSON.stringify(cpuData, null, 2));

        console.log('\n--- Interpreted Values ---');
        console.log('Current Load:', cpuData.currentLoad);
        console.log('Average Load:', cpuData.avg);
        console.log('User:', cpuData.currentLoadUser);
        console.log('System:', cpuData.currentLoadSystem);

        console.log('\n--- OS Load Avg ---');
        console.log(os.loadavg());

    } catch (error) {
        console.error('Error:', error);
    }
}

checkCPU();
