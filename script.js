const dropZone = document.getElementById('drop_zone');
const fileInput = document.getElementById('fileInput');
const downloadLink = document.getElementById('downloadLink');
const outputAudio = document.getElementById('outputAudio');

// Event listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleFileDrop);
fileInput.addEventListener('change', handleFileSelect);

function handleDragOver(event) {
    event.preventDefault();
    dropZone.classList.add('dragover');
}

function handleDragLeave(event) {
    event.preventDefault();
    dropZone.classList.remove('dragover');
}

function handleFileDrop(event) {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        processAudio();
    }
}

function handleFileSelect(event) {
    processAudio();
}

let HTMLSpeed = getSelectedRadioValue('speed');
let HTMLsampleRate = getSelectedRadioValue('fidelity');

function getSelectedRadioValue(name) {
    const selectedRadio = document.querySelector(`input[name="${name}"]:checked`);
    return selectedRadio ? selectedRadio.value : null;
}

function getSampleRate(fidelity) {
    switch (fidelity) {
        case 'SP-1200':
            return 26000;
        case 'SK-1':
            return 9000;
        default:
            return 46000;
    }
}

function getBitDepth(fidelity) {
    switch (fidelity) {
        case 'SP-1200':
            return 12;
        case 'SK-1':
            return 8;
        default:
            return 16;
    }
}

function getSpeedFactor(speed) {
    switch (speed) {
        case '2x':
            return 2;
        case '4x':
            return 4;
        default:
            return 1;
    }
}

function extractBpmAndKey(fileName) {
    // Extract BPM as the last number in the file name between 55 and 190
    const bpmMatch = fileName.match(/(\d+)(?!.*\d)/);
    const bpm = bpmMatch ? parseInt(bpmMatch[0]) : 'Unknown';

    // Check if BPM is within the valid range (55 to 190)
    const validBpm = bpm >= 55 && bpm <= 190 ? bpm : 'Unknown';

    // Extract key (optional): you can adjust this regex based on your naming conventions
    const keyMatch = fileName.match(/\b([A-G][#b]?m?)\b/i);
    const key = keyMatch ? keyMatch[1] : 'Unknown';

    return {
        bpm: validBpm,
        key
    };
}

async function processAudio() {
    let getSpeedButton = getSelectedRadioValue("speed")
    let getFidelityButton = getSelectedRadioValue("fidelity")
    let channelNr = getSelectedRadioValue("channels")
    let speedVal = getSpeedFactor(getSpeedButton)
    let sRateVal = getSampleRate(getFidelityButton)
    let bitVal = getBitDepth(getFidelityButton)
    console.log("Speed: " + speedVal + " Rate: " + sRateVal + " BD: " + bitVal + " Channel: " + channelNr)

    const file = fileInput.files[0];
    if (!file) {
        alert('Please select an audio file.');
        return;
    }

    const audioContext = new(window.AudioContext || window.webkitAudioContext)();
    const reader = new FileReader();

    reader.onload = async function (event) {
        const audioBuffer = event.target.result;
        const buffer = await audioContext.decodeAudioData(audioBuffer);

        // Check if the audio duration is less than 30 seconds
        if (buffer.duration >= 30) {
            alert('Please upload an audio file less than 30 seconds long.');
            return;
        }
        // Get and display the file name
        const fileName = file.name;
        console.log(`Processing file: ${fileName}`);
        //document.getElementById('fileNameDisplay').textContent = `Processing file: ${fileName}`;

        const { bpm, key } = extractBpmAndKey(fileName);
        console.log(`Extracted BPM: ${bpm}, Key: ${key}`);
        
        // Doubling the speed by halving the buffer duration
        const channelData = [];
        let x = speedVal;
        const length = Math.floor(buffer.length / x);
        let newBuffer;

        if (channelNr === '1') { // Mono
            const monoData = new Float32Array(length);

            for (let j = 0; j < length; j++) {
                monoData[j] = (buffer.getChannelData(0)[j * x] + buffer.getChannelData(1)[j * x]) / 2;
            }
            newBuffer = audioContext.createBuffer(1, length, buffer.sampleRate);
            newBuffer.copyToChannel(monoData, 0);
        } else { // Stereo
            for (let i = 0; i < buffer.numberOfChannels; i++) {
                const inputData = buffer.getChannelData(i);
                const newData = new Float32Array(length);

                for (let j = 0; j < length; j++) {
                    newData[j] = inputData[j * x];
                }
                channelData.push(newData);
            }

            // Creating a new buffer with the modified channel data
            newBuffer = audioContext.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);

            for (let i = 0; i < buffer.numberOfChannels; i++) {
                newBuffer.copyToChannel(channelData[i], i);
            }
        }

        let newSampleRate = sRateVal;
        const resampledBuffer = resampleBuffer(newBuffer, buffer.sampleRate, newSampleRate);

        let bitDepth = bitVal;
        const modifiedBuffer = quantizeBuffer(resampledBuffer, bitDepth, audioContext);

        await encodeResampledAudio(modifiedBuffer, bpm, key, bitDepth);

        fileInput.value = '';
    };

    reader.readAsArrayBuffer(file);
}

function resampleBuffer(buffer, sampleRate, newSampleRate) {
    const audioContext = new(window.AudioContext || window.webkitAudioContext)();
    const newLength = Math.floor(buffer.length * newSampleRate / sampleRate);
    const newBuffer = audioContext.createBuffer(buffer.numberOfChannels, newLength, newSampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const inputData = buffer.getChannelData(channel);
        const outputData = newBuffer.getChannelData(channel);

        for (let i = 0; i < newLength; i++) {
            const ratio = i * sampleRate / newSampleRate;
            const index = Math.floor(ratio);
            const frac = ratio - index;

            outputData[i] = inputData[index] * (1 - frac) + inputData[index + 1] * frac;
        }
    }

    return newBuffer;
}

function quantizeBuffer(buffer, bitDepth, audioContext) {
    const maxValue = Math.pow(2, bitDepth) - 1;
    const newBuffer = audioContext.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const inputData = buffer.getChannelData(channel);
        const outputData = newBuffer.getChannelData(channel);

        for (let i = 0; i < buffer.length; i++) {
            const quantizedValue = Math.round(inputData[i] * maxValue) / maxValue;
            outputData[i] = quantizedValue;
        }
    }

    return newBuffer;
}

async function encodeResampledAudio(buffer, bpm, key, bitDepth) {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const samples = buffer.length;

    const wavBuffer = audioBufferToWav(buffer, bitDepth);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    const newFileName = `${bpm} ${key}.wav`;

    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = newFileName;
    downloadLink.click();
}

function audioBufferToWav(buffer, bitDepth) {
    const numOfChannels = buffer.numberOfChannels;
    const length = buffer.length * numOfChannels * (bitDepth / 8) + 44;
    const result = new ArrayBuffer(length);
    const view = new DataView(result);
    const channels = [];
    let offset = 0;
    let pos = 0;

    // Write WAV header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChannels);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * (bitDepth / 8) * numOfChannels); // avg. bytes/sec
    setUint16(numOfChannels * (bitDepth / 8)); // block-align
    setUint16(bitDepth); // bit depth

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // Write interleaved data
    for (let i = 0; i < buffer.numberOfChannels; i++)
        channels.push(buffer.getChannelData(i));

    while (pos < length) {
        for (let i = 0; i < numOfChannels; i++) { // interleave channels
            let sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            if (bitDepth === 8) {
                // Convert to 8-bit unsigned
                sample = ((sample + 1) * 127.5) | 0;
                view.setUint8(pos, sample);
            } else {
                // Convert to signed int
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                if (bitDepth === 16) {
                    view.setInt16(pos, sample, true);
                } else if (bitDepth === 24) {
                    view.setInt32(pos, sample << 8, true);
                } else if (bitDepth === 32) {
                    view.setInt32(pos, sample, true);
                }
            }
            pos += bitDepth / 8;
        }
        offset++; // next source sample
    }

    return result;

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}
