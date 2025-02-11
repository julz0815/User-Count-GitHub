import { promises as fs } from 'fs';
import { Octokit } from "@octokit/rest";

const orgName = "GITHUB_ORG_NAME";
const maxRequestsPerMinute = 30; // Set your desired limit here

// Instantiate Octokit with your GitHub personal access token
const octokit = new Octokit({
  auth: "YOUR-TOKEN"
});

// Function to fetch all repositories for a given organization with throttling
async function getAllRepositoriesWithThrottle(org: string, maxRequestsPerMinute: number) {
  const repositories: any[] = [];
  const perPage = 100;
  let page = 1;
  const maxRequestsPerSecond = maxRequestsPerMinute / 60;
  let remainingRequests = maxRequestsPerMinute;

  while (true) {
    const startTime = Date.now();

    const response = await octokit.repos.listForOrg({
      org,
      per_page: perPage,
      page
    });

    if (response.data.length === 0) break;

    for ( let i=0 ; i<response.data.length ; i++){
      repositories.push(response.data[i].name);
    }

    remainingRequests--;

    if (remainingRequests === 0) {
      const elapsedTime = Date.now() - startTime;
      const delay = Math.ceil(1000 / maxRequestsPerSecond) - elapsedTime;
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      remainingRequests = maxRequestsPerMinute;
    }
    console.log("Fetched repositories - page "+ page);
    page++;
  }
  return repositories;
}

// Function to find all contributing users for a repository within the last 90 days
async function getContributors(owner: string, repo: string) {
  console.log('-Fetching commits for '+repo)
  // Get the date 90 days ago from now
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Format the date as required by the GitHub API (ISO 8601)
  const sinceDate = ninetyDaysAgo.toISOString();

  // Initialize an empty array to store all contributors
  let allContributors:any = [];

  // Initialize page number
  let page = 1;

  while (true) {
    // Fetch commits since the specified date
    let response: any;
    try {
      response = await octokit.repos.listCommits({
        owner,
        repo,
        since: sinceDate,
        page,
        per_page: 100 // Fetch 100 commits per page
      });
    }
    catch (error) {
      console.log('-Error fetching contributors for ' + repo + ': ' + error);
      break;
    }

    // If the response is empty, break the loop
    if (response.data.length === 0) {
      break;
    }

    // Add the contributors from the current page to allContributors
    allContributors = allContributors.concat(response.data);

    // Increment the page number for the next iteration
    console.log('--Fetchging page '+page)
    page++;

    // Delay the next request by 1 second to limit to 60 requests per minute
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return allContributors;
}

// Function to write contributors to a CSV file
async function writeContributorsToCSV(repo:any,contributors:any) {
  const filePath = 'repos/'+repo+'-contributors.csv';
  var csvContent = JSON.stringify(contributors);
  ;
  await fs.writeFile(filePath, csvContent);
  console.log(`---Commits have been written to ${filePath}\n`);
}

async function storeReposToFile(repositories: any[]){
  const filePath = `repositories.txt`;
  let csvContent = '';
  repositories.forEach((repoName) => {
    csvContent += `${repoName}\n`;
  });
  await fs.writeFile(filePath, csvContent);
  console.log(`Repositories have been written to ${filePath}`);
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAllUsers (){

  let repositories:any = [];

  //check if the file repsitories.txt exist
  const repositoriesExist = await fs.access('repositories.txt')
    .then(() => true)
    .catch(() => false);

  if (repositoriesExist) {
    console.log('File repositories.txt exists - mo need to fetch again');
    const data = await fs.readFile('repositories.txt', 'utf8');
    console.log('Repos from file: '+data)
    repositories = data.split('\n');
  } else {
    repositories = await getAllRepositoriesWithThrottle(orgName, maxRequestsPerMinute);
    storeReposToFile(repositories)
  }

  console.log(repositories)
  
  //fetch contributors per repo
  const numberOfRepos = repositories.length
  console.log(numberOfRepos+' repositories fetched')
  for (const repo of repositories) {
    //wait 3 seconds before the next request to throttle
    await wait(3000);
    const contributorFilesExist = await fs.access('repos/'+repo+'-contributors.csv')
    .then(() => true)
    .catch(() => false);

    if (contributorFilesExist){
      console.log('Commits file for '+repo+' exists - no need to fetch again');
    }
    else {
      const contributors = await getContributors(orgName, repo);
      const numberOfContributors = contributors.length
      console.log('--Commits for '+repo+': '+numberOfContributors)
      await writeContributorsToCSV(repo,contributors);
    }
  }

  // Read all contributor files and consolidate to unique contributors
  const uniqueContributors: Set<string> = new Set();
  const uniqueContributorsOthers: Set<string> = new Set();
  for (const repo of repositories) {
    const contributorFilePath = `repos/${repo}-contributors.csv`;
    const contributorFileExists = await fs.access(contributorFilePath)
      .then(() => true)
      .catch(() => false);
    if (contributorFileExists) {
      const contributorFileContent = await fs.readFile(contributorFilePath, 'utf8');
      const contributors = JSON.parse(contributorFileContent);
      const countFromFile = contributors.length
      for ( let i=0 ; i<countFromFile ; i++){
        const pattern = /[\w.-]+github\.com/i;
        if ( pattern.test(contributors[i].commit.author.email) ) {
          uniqueContributorsOthers.add(contributors[i].commit.author.email);
        }
        else {
          uniqueContributors.add(contributors[i].commit.author.email);
        }
      }
    }
  }

  // Save unique contributors to a file
  const contributorsFilePath = 'unique-contributors.txt';
  const contrinutorsArray = Array.from(uniqueContributors)
  const contributorsCount = contrinutorsArray.length
  const contributorsContent = 'Total number of unique contributors in the last 90 days: '+contributorsCount+'\n'+contrinutorsArray.join('\n');
  await fs.writeFile(contributorsFilePath, contributorsContent);
  console.log(`Unique contributors have been written to ${contributorsFilePath}`);

  const contributorsFilePathOthers = 'unique-contributors-others.txt';
  const contrinutorsArrayOthers = Array.from(uniqueContributorsOthers)
  const contributorsCountOthers = contrinutorsArrayOthers.length
  const contributorsContentOthers = 'Total number of unique contributors in the last 90 days: '+contributorsCountOthers+'\n'+contrinutorsArrayOthers.join('\n');
  await fs.writeFile(contributorsFilePathOthers, contributorsContentOthers);
  console.log(`Unique contributors have been written to ${contributorsFilePathOthers}`);


}

getAllUsers()