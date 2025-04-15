import { promises as fs } from 'fs';
import { Octokit } from "@octokit/rest";
import * as readline from 'readline';

interface Commit {
  commit: {
    author: {
      email: string;
      name: string;
    };
  };
}

interface Repository {
  name: string;
  selected?: boolean;
}

// Parse command line arguments
const args = process.argv.slice(2);
const token = args[0];
const orgName = args[1];

// Default values
let domain = 'https://api.github.com';
let forceReload = false;
let interactive = false;
let regexPattern = '/[\\w.-]+github\\.com/i';
let regexFile: string | null = null;
const maxRequestsPerMinute = 30;

// Parse arguments
for (let i = 2; i < args.length; i++) {
  const arg = args[i];
  
  if (arg.startsWith('--')) {
    // Handle flags
    switch (arg) {
      case '--force-reload':
        forceReload = true;
        break;
      case '--interactive':
        interactive = true;
        break;
      case '--regex':
        if (i + 1 < args.length) {
          regexPattern = args[++i];
        }
        break;
      case '--regex-file':
        if (i + 1 < args.length) {
          regexFile = args[++i];
        }
        break;
    }
  } else if (i === 2) {
    // First non-flag argument after orgName is the domain
    domain = arg;
  }
}

if (!token || !orgName) {
  console.error('Error: Please provide both a GitHub personal access token and organization name as arguments.');
  console.error('Usage: ts-node src/index.ts <token> <organization> [domain] [options]');
  console.error('Options:');
  console.error('  --force-reload    Force reload of repositories');
  console.error('  --interactive     Enable interactive repository selection');
  console.error('  --regex <pattern> Use custom regex pattern (default: /[\\w.-]+github\\.com/i)');
  console.error('  --regex-file <file> Read regex pattern from file');
  process.exit(1);
}

// Create readline interface for interactive mode
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt user for input
const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

// Function to get regex pattern
async function getRegexPattern(): Promise<RegExp> {
  if (regexFile) {
    try {
      const pattern = await fs.readFile(regexFile, 'utf8');
      return new RegExp(pattern.trim());
    } catch (error) {
      console.error(`Error reading regex file: ${error}`);
      process.exit(1);
    }
  }
  
  // Handle regex pattern with flags
  const match = regexPattern.match(/^\/(.*)\/([a-z]*)$/);
  if (match) {
    const [, pattern, flags] = match;
    console.log(`Using regex pattern: ${pattern} with flags: ${flags}`);
    return new RegExp(pattern, flags);
  }
  
  // If no slashes, treat as a simple pattern
  console.log(`Using simple pattern: ${regexPattern}`);
  return new RegExp(regexPattern, 'i');
}

// Instantiate Octokit with your GitHub personal access token
const octokit = new Octokit({
  auth: token,
  baseUrl: domain,
  userAgent: 'github-contributor-counter',
  request: {
    timeout: 10000
  }
});

// Function to fetch all repositories for a given organization with throttling
async function getAllRepositoriesWithThrottle(org: string, maxRequestsPerMinute: number): Promise<string[]> {
  const repositories: string[] = [];
  const perPage = 100;
  let page = 1;
  const maxRequestsPerSecond = maxRequestsPerMinute / 60;
  let remainingRequests = maxRequestsPerMinute;
  let totalRepos = 0;

  try {
    // First, verify the organization exists and we have access
    console.log(`Verifying access to organization ${org}...`);
    try {
      const response = await octokit.rest.orgs.get({
        org
      });
      console.log('Organization access verified successfully');
      console.log(`Organization details: ${JSON.stringify(response.data, null, 2)}`);
    } catch (error) {
      console.error('Full error details:', error);
      if (error instanceof Error) {
        if (error.message.includes('Not Found')) {
          console.error(`Error: Organization "${org}" not found. Please verify the organization name is correct.`);
        } else if (error.message.includes('Bad credentials')) {
          console.error('Error: Invalid GitHub token. Please verify your token is correct and has the necessary permissions.');
        } else {
          console.error(`Error verifying organization: ${error.message}`);
          console.error('Error stack:', error.stack);
        }
      } else {
        console.error('Unknown error type:', error);
      }
      throw error;
    }

    while (true) {
      const startTime = Date.now();

      try {
        console.log(`Fetching repositories page ${page}...`);
        const response = await octokit.rest.repos.listForOrg({
          org,
          per_page: perPage,
          page,
          type: 'all'
        });

        if (response.data.length === 0) {
          console.log('No more repositories found');
          break;
        }

        const newRepos = response.data.map((repo: Repository) => repo.name);
        repositories.push(...newRepos);
        totalRepos += newRepos.length;

        remainingRequests--;

        if (remainingRequests === 0) {
          const elapsedTime = Date.now() - startTime;
          const delay = Math.ceil(1000 / maxRequestsPerSecond) - elapsedTime;
          if (delay > 0) {
            console.log(`Rate limit reached, waiting ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          remainingRequests = maxRequestsPerMinute;
        }

        console.log(`Fetched ${totalRepos} repositories (page ${page})`);
        page++;
      } catch (error) {
        console.error('Full error details:', error);
        if (error instanceof Error) {
          console.error(`Error fetching repositories (page ${page}): ${error.message}`);
          console.error('Error stack:', error.stack);
          if (error.message.includes('API rate limit exceeded')) {
            console.log('Rate limit exceeded. Waiting before retrying...');
            await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
            continue;
          }
        } else {
          console.error('Unknown error type:', error);
        }
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error in getAllRepositoriesWithThrottle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
    throw error;
  }

  if (totalRepos === 0) {
    console.log('No repositories found for the organization. Please verify the organization name and your access permissions.');
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

async function getAllUsers() {
  console.log('Starting contributor analysis...');
  console.log(`Organization: ${orgName}`);
  console.log(`GitHub Domain: ${domain}`);
  console.log(`Time period: Last 90 days`);

  let repositories: Repository[] = [];
  const regex = await getRegexPattern();

  try {
    // Check if repositories.txt exists and force reload is not set
    const repositoriesExist = await fs.access('repositories.txt')
      .then(() => true)
      .catch(() => false);

    if (repositoriesExist && !forceReload) {
      console.log('Using cached repositories from repositories.txt');
      const data = await fs.readFile('repositories.txt', 'utf8');
      repositories = data.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const [name, selected] = line.split(',');
          return { name, selected: selected === 'true' };
        });
    } else {
      console.log('Fetching repositories from GitHub...');
      const repoNames = await getAllRepositoriesWithThrottle(orgName, maxRequestsPerMinute);
      repositories = repoNames.map(name => ({ name, selected: true })); // Default to all repositories selected
    }

    // Interactive mode for repository selection
    if (interactive && (!repositoriesExist || forceReload)) {
      console.log('\nInteractive repository selection mode:');
      for (const repo of repositories) {
        const answer = await question(`Include repository ${repo.name}? (y/n): `);
        repo.selected = answer.toLowerCase() === 'y';
      }
    } else if (!repositoriesExist || forceReload) {
      // Save all repositories as selected by default
      const repoContent = repositories
        .map(repo => `${repo.name},${repo.selected}`)
        .join('\n');
      await fs.writeFile('repositories.txt', repoContent);

      console.log('\nRepositories have been fetched and saved to repositories.txt');
      console.log('To review and modify repository selection:');
      console.log('1. Open repositories.txt in a text editor');
      console.log('2. Each line should be in the format: repositoryName,true/false');
      console.log('   - true means the repository will be processed');
      console.log('   - false means the repository will be skipped');
      console.log('3. Change the true/false value for each repository as needed');
      console.log('4. Save the file and run the script again without --force-reload');
      console.log('\nTo process all repositories, run the script again without any changes');
      console.log('To process only specific repositories, modify the true/false values and run again');
      console.log('\nTo fetch repositories again, use --force-reload');
      console.log('To use interactive selection, use --interactive');
      return;
    }

    // Save repository selection
    const repoContent = repositories
      .map(repo => `${repo.name},${repo.selected}`)
      .join('\n');
    await fs.writeFile('repositories.txt', repoContent);

    // Filter repositories based on selection
    const selectedRepositories = repositories.filter(repo => repo.selected);
    console.log(`\nProcessing ${selectedRepositories.length} selected repositories`);

    // Create repos directory if it doesn't exist
    try {
      await fs.mkdir('repos', { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }

    // Process each selected repository
    for (const [index, repo] of selectedRepositories.entries()) {
      console.log(`\nProcessing repository ${index + 1}/${selectedRepositories.length}: ${repo.name}`);
      
      const contributorFilePath = `repos/${repo.name}-contributors.csv`;
      const contributorFileExists = await fs.access(contributorFilePath)
        .then(() => true)
        .catch(() => false);

      // Always recreate commit files if force reload is set
      if (forceReload || !contributorFileExists) {
        console.log(`Fetching commits for ${repo.name}...`);
        const contributors = await getContributors(orgName, repo.name);
        await writeContributorsToCSV(repo.name, contributors);
      } else {
        console.log(`Using cached commits for ${repo.name}`);
      }
    }

    // Consolidate unique contributors
    console.log('\nConsolidating unique contributors...');
    const uniqueContributors: Set<string> = new Set();
    const uniqueContributorsOthers: Set<string> = new Set();

    for (const repo of selectedRepositories) {
      const contributorFilePath = `repos/${repo.name}-contributors.csv`;
      const contributorFileExists = await fs.access(contributorFilePath)
        .then(() => true)
        .catch(() => false);

      if (contributorFileExists) {
        const contributorFileContent = await fs.readFile(contributorFilePath, 'utf8');
        const contributors = JSON.parse(contributorFileContent) as Commit[];
        
        for (const contributor of contributors) {
          const email = contributor.commit.author.email.toLowerCase();
          const matches = regex.test(email);
          //console.log(`Email: ${email}, Pattern: ${regex.toString()}, Matches: ${matches}`);
          
          if (matches) {
            // If email matches the pattern (e.g., gmail.com), put it in others
            uniqueContributorsOthers.add(email);
            //console.log(`Added to others: ${email}`);
          } else {
            // If email doesn't match the pattern, put it in regular contributors
            uniqueContributors.add(email);
            //console.log(`Added to regular: ${email}`);
          }
        }
      }
    }

    // Save results
    const contributorsArray = Array.from(uniqueContributors);
    const contributorsArrayOthers = Array.from(uniqueContributorsOthers);
    
    const contributorsContent = `Total number of unique contributors in the last 90 days: ${contributorsArray.length}\n${contributorsArray.join('\n')}`;
    const contributorsContentOthers = `Total number of unique contributors in the last 90 days: ${contributorsArrayOthers.length}\n${contributorsArrayOthers.join('\n')}`;

    await fs.writeFile('unique-contributors.txt', contributorsContent);
    await fs.writeFile('unique-contributors-others.txt', contributorsContentOthers);

    console.log('\nAnalysis complete!');
    console.log(`Total unique contributors: ${contributorsArray.length}`);
    console.log(`Total unique GitHub contributors: ${contributorsArrayOthers.length}`);
    console.log('Results saved to unique-contributors.txt and unique-contributors-others.txt');

  } catch (error) {
    console.error('Error during analysis:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the analysis
getAllUsers().catch(error => {
  console.error('Fatal error:', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});