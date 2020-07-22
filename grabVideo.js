const request = require('request');
const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;

//Sanitizes post title to avoid folders ending in '.'
function sanitizeTitle(title) {
  if(title.endsWith(".")) return sanitizeTitle(title.slice(0, -1));
  return title;
}

//Gets thread JSON from reddit
function getThreadData(threadURL) {
  return new Promise((resolve, reject) => {
    //Get JSON URL
    jsonURL = threadURL.replace(/\/\s*$/, ".json");

    //Request JSON file
    request({url: jsonURL, json: true}, function(err, response, body) {
      if(err) reject(err);

      //Get and return relevant data object
      let data = body[0].data.children[0].data;
      resolve(data);
    });
  });
}

//Download file from URL to FILEPATH
function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {

    //Create file write stream
    let file = fs.createWriteStream(filepath);

    //Request file from url
    let fileRequest = request.get(url);

    //Check response code
    fileRequest.on('response', function(response) {
      if(response.statusCode !== 200) {
        fs.unlink(filepath, () => {}) //Delete file async without checking result
        reject('Response status: '+response.statusCode); //Reject promise
      }
    });

    //Handle request errors
    fileRequest.on('error', function(err) {
      fs.unlink(filepath) //Delete file async without checking result
      reject('Request error: '+err.message); //Reject promise
    });

    //Pipe response to write stream
    fileRequest.pipe(file);
    file.on('finish', function() {
      file.close(resolve); //close() is async, resolve promise after it completes
    });

    //Handle file errors
    file.on('error', function(err) {
      fs.unlink(filepath, ()=>{}) //Delete file async without checking result
      reject('File error: '+err.message); //Reject promise
    });
  });
}

//Delete directory and its files
function removeDirectory(dirPath) {
  return new Promise((resolve, reject) => {
    if(!fs.existsSync(dirPath)) reject('NotFound');
    try{
      fs.readdirSync(dirPath).forEach((file, index) => {
        const curFilepath = path.join(dirPath, file);
        if(fs.lstatSync(curFilepath).isDirectory()) {
          removeDirectory(curFilepath);
        } else {
          fs.unlinkSync(curFilepath);
        }
      });
    } catch (err) {
      reject(err);
    }
  });

}


//Merge audio and video files using ffmpeg
function mergeFiles(audioPath, videoPath, outputPath) {
  return new Promise((resolve, reject) => {
  
    let ffmpegArgs = ['-y', outputPath, '-i', videoPath];
    if(audioPath) ffmpegArgs = [...ffmpegArgs, '-i', audioPath];
  
    //Spawn ffmpeg process
    let ffmpeg = spawn("ffmpeg", ffmpegArgs);

    //Resolve promise if merge is successfull
    ffmpeg.on('exit', (statusCode) => {
      if(statusCode == 0) resolve();
      else reject(statusCode);
    });
  });
}

//Begin script
async function run(){
  //Get command line arguments
  let args = process.argv.slice(2);
  //Set thread URL
  let threadURL = args[0];

  //Get and validate thread data
  let threadData = await getThreadData(threadURL);
  let domain = threadData.domain;

  if(domain !== 'v.redd.it') {
    console.log('Thread does not contain a v.redd.it video.');
    return;
  }

  let subreddit = threadData.subreddit;
  let subredditLink = 'r/'+subreddit;
  let title = threadData.title;
  let safeTitle = sanitizeTitle(title);
  let author = threadData.author;

  let videoURL = threadData.secure_media.reddit_video.fallback_url;
  let audioURL = threadData.url + '/DASH_audio.mp4';
  console.log(`\nGot thread data:\n\tSubreddit: ${subredditLink}\n\tTitle: ${title}\n\tAuthor: ${author}\n\tVideo URL: ${videoURL}\n\tAudio URL: ${audioURL}\n`);

  //Download video and audio files
  let directoryPath = path.resolve(`./output/${subreddit}/${safeTitle}`);
  let videoFilepath = path.resolve(`${directoryPath}/video.mp4`);
  let audioFilepath = path.resolve(`${directoryPath}/audio.mp4`);
  let outputFilepath = path.resolve(`${directoryPath}/${safeTitle}.mp4`);

  try{
    fs.mkdirSync(directoryPath, {recursive: true});
  } catch(err) {
    console.log("Failed to create directory. " + err);
    console.log("Exiting...");
    return;
  }

  console.log('Downloading video file...');
  try {
    await downloadFile(videoURL, videoFilepath);
    console.log('Downloaded video.\n');
  } catch (err) {
    console.log("Error downloading video. " + err);
    console.log("Cleaning up and exiting...");
    await removeDirectory(directoryPath);
    return;
  }

  console.log('Downloading audio file...');
  try {
    await downloadFile(audioURL, audioFilepath);
    console.log('Downloaded audio.\n');
  } catch(err) {
    console.log("Error downloading audio. " + err+'\n');
    audioFilepath = null;
  }
  
  //Merge/reencode files
  if(audioFilepath) { 
    console.log('Merging audio and video together...');    
  } else {
    console.log("No audio to merge...");
    console.log("Reencoding video...");
  }
  
  try{
    await mergeFiles(audioFilepath, videoFilepath, outputFilepath);
  } catch (statusCode) {
    console.log("FFMPEG Error! Exit code: " + statusCode);
    console.log("Cleaning up and exiting...");
    await removeDirectory(directoryPath);
    return;
  }
  console.log('Done!');
  console.log(`\nOutput file: ${outputFilepath}`);
}

try {
  run();
} catch (err) {
  console.log('An error occurred: '+err);
}
