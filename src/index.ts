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
  org?: string;
  selected?: boolean;
}

// Parse command line arguments
const args = process.argv.slice(2);
const token = args[0];
let domain = 'https://api.github.com'; // Default to api.github.com
let forceReload = false;
let interactive = false;
let regexPattern = '/github\\.com$/i';
let regexFile: string | undefined;
const maxRequestsPerMinute = 30;

// Parse additional arguments
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--force-reload') {
    forceReload = true;
  } else if (args[i] === '--interactive') {
    interactive = true;
  } else if (args[i] === '--regex' && i + 1 < args.length) {
    regexPattern = args[++i];
  } else if (args[i] === '--regex-file' && i + 1 < args.length) {
    regexFile = args[++i];
  } else if (!args[i].startsWith('--')) {
    // If it's not a flag, it's the domain
    domain = args[i];
  }
}

// Validate domain
if (!domain.startsWith('https://')) {
  console.error('Error: Domain must start with https://');
  process.exit(1);
}

// Ensure we're using the API endpoint
const apiDomain = domain.includes('api.github.com') ? domain : 'https://api.github.com';

if (!token) {
  console.error('Error: Please provide a GitHub personal access token.');
  console.error('Usage: ts-node src/index.ts <token> [domain] [options]');
  console.error('Options:');
  console.error('  --force-reload    Force reload of repositories');
  console.error('  --interactive    Enable interactive repository selection');
  console.error('  --regex <pattern> Use custom regex pattern for email categorization');
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
  baseUrl: apiDomain,
  userAgent: 'github-contributor-counter',
  request: {
    timeout: 30000, // Increase timeout to 30 seconds
    retries: 3, // Add retries for failed requests
    retryAfter: 5 // Wait 5 seconds between retries
  }
});

// Function to fetch all repositories with throttling
async function getAllRepositoriesWithThrottle(maxRequestsPerMinute: number): Promise<Repository[]> {
  const repositories: Repository[] = [];
  const perPage = 100;
  let page = 1;
  const maxRequestsPerSecond = maxRequestsPerMinute / 60;
  let remainingRequests = maxRequestsPerMinute;
  let totalRepos = 0;
  let retryCount = 0;
  const maxRetries = 3;

  try {
    while (true) {
      const startTime = Date.now();

      try {
        console.log(`Fetching repositories page ${page}...`);
        console.log(`Using API endpoint: ${apiDomain}`);
        
        const response = await octokit.rest.repos.listForAuthenticatedUser({
          per_page: perPage,
          page,
          type: 'all'
        });

        if (response.data.length === 0) {
          console.log('No more repositories found');
          break;
        }

        const newRepos = response.data.map((repo: any) => ({
          name: repo.name,
          org: repo.owner?.login,
          selected: true
        }));
        repositories.push(...newRepos);
        totalRepos += newRepos.length;

        remainingRequests--;
        retryCount = 0; // Reset retry count on successful request

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
          } else if (error.message.includes('timeout') || error.message.includes('connect')) {
            retryCount++;
            if (retryCount <= maxRetries) {
              console.log(`Connection timeout, retrying (${retryCount}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
              continue;
            } else {
              console.error('Max retries reached. Please check your network connection and try again.');
              throw error;
            }
          } else if (error.message.includes('Bad credentials')) {
            console.error('Error: Invalid GitHub token. Please verify your token is correct and has the necessary permissions.');
            process.exit(1);
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
    console.log('No repositories found. Please verify your token has the necessary permissions.');
  }

  return repositories;
}

// Function to find all contributing users for a repository within the last 90 days
async function getContributors(owner: string, repo: string) {
  console.log(`-Fetching commits for ${owner}/${repo}`);
  // Get the date 90 days ago from now
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Format the date as required by the GitHub API (ISO 8601)
  const sinceDate = ninetyDaysAgo.toISOString();

  // Initialize an empty array to store all contributors
  let allContributors: any = [];

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
      console.log(`-Error fetching contributors for ${owner}/${repo}: ${error}`);
      break;
    }

    // If the response is empty, break the loop
    if (response.data.length === 0) {
      break;
    }

    // Add the contributors from the current page to allContributors
    allContributors = allContributors.concat(response.data);

    // Increment the page number for the next iteration
    console.log(`--Fetched page ${page} with ${response.data.length} commits`);
    page++;

    // Delay the next request by 1 second to limit to 60 requests per minute
    await new Promise(resolve => setTimeout(resolve, 1000));
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

// Function to delete cached commit files
async function deleteCachedCommitFiles(): Promise<void> {
  try {
    const files = await fs.readdir('repos');
    for (const file of files) {
      if (file.endsWith('-contributors.csv')) {
        await fs.unlink(`repos/${file}`);
        console.log(`Deleted cached file: repos/${file}`);
      }
    }
  } catch (error) {
    console.error('Error deleting cached files:', error);
  }
}

// Function to write committers per repo to a file
async function writeCommittersPerRepo(committers: Map<string, Set<string>>): Promise<void> {
  const filePath = 'committers-per-repo.txt';
  let content = '';
  
  for (const [repo, committerSet] of committers) {
    content += `${repo}\n`;
    for (const committer of committerSet) {
      content += `  ${committer}\n`;
    }
    content += '\n';
  }
  
  await fs.writeFile(filePath, content);
  console.log(`Committers per repo saved to ${filePath}`);
  console.log(`Total repositories with committers: ${committers.size}`);
  let totalCommitters = 0;
  for (const committerSet of committers.values()) {
    totalCommitters += committerSet.size;
  }
  console.log(`Total unique committers across all repositories: ${totalCommitters}`);
}

async function getAllUsers() {
  console.log('Starting contributor analysis...');
  console.log(`GitHub Domain: ${domain}`);
  console.log(`Time period: Last 90 days`);

  let repositories: Repository[] = [];
  const regex = await getRegexPattern();
  const committersPerRepo = new Map<string, Set<string>>();

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
          const [name, org, selected] = line.split(',');
          return { name, org, selected: selected === 'true' };
        });
    } else {
      // Delete cached files if force-reload is specified
      if (forceReload) {
        console.log('Force reload specified, deleting cached files...');
        await deleteCachedCommitFiles();
        try {
          await fs.access('repositories.txt');
          await fs.unlink('repositories.txt');
          console.log('Deleted repositories.txt');
        } catch (error) {
          // File doesn't exist, which is fine
        }
      }

      console.log('Fetching repositories from GitHub...');
      repositories = await getAllRepositoriesWithThrottle(maxRequestsPerMinute);
      
      // Save repositories to file
      const repoContent = repositories
        .map(repo => `${repo.name},${repo.org},${repo.selected}`)
        .join('\n');
      await fs.writeFile('repositories.txt', repoContent);

      // Interactive mode for repository selection
      if (interactive) {
        console.log('\nInteractive repository selection mode:');
        for (const repo of repositories) {
          const answer = await question(`Include repository ${repo.name}? (y/n): `);
          repo.selected = answer.toLowerCase() === 'y';
        }
      } else {
        // Save all repositories as selected by default
        console.log('\nRepositories have been fetched and saved to repositories.txt');
        console.log('To review and modify repository selection:');
        console.log('1. Open repositories.txt in a text editor');
        console.log('2. Each line should be in the format: repositoryName,organization,true/false');
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
      const updatedRepoContent = repositories
        .map(repo => `${repo.name},${repo.org},${repo.selected}`)
        .join('\n');
      await fs.writeFile('repositories.txt', updatedRepoContent);
    }

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

      if (forceReload || !contributorFileExists) {
        console.log(`Fetching commits for ${repo.name}...`);
        if (!repo.org) {
          console.log(`Warning: No organization found for repository ${repo.name}, skipping...`);
          continue;
        }
        const contributors = await getContributors(repo.org, repo.name);
        if (contributors.length > 0) {
          await writeContributorsToCSV(repo.name, contributors);
          console.log(`Found ${contributors.length} commits for ${repo.name}`);
          
          // Only read the file if we found commits and wrote them
          const repoCommitters = new Set<string>();
          try {
            const contributorFileContent = await fs.readFile(contributorFilePath, 'utf8');
            const contributors = JSON.parse(contributorFileContent) as Commit[];
            
            for (const contributor of contributors) {
              const email = contributor.commit.author.email.toLowerCase();
              repoCommitters.add(email);
            }
            console.log(`Found ${repoCommitters.size} unique committers for ${repo.name}`);
            
            // Get the full repo name with org if available
            const fullRepoName = repo.org ? `${repo.org}/${repo.name}` : repo.name;
            committersPerRepo.set(fullRepoName, repoCommitters);
          } catch (error) {
            console.error(`Error reading contributors for ${repo.name}:`, error);
          }
        } else {
          console.log(`No commits found for ${repo.name} in the last 90 days`);
        }
      } else {
        console.log(`Using cached commits for ${repo.name}`);
        // Read from existing file
        const repoCommitters = new Set<string>();
        try {
          const contributorFileContent = await fs.readFile(contributorFilePath, 'utf8');
          const contributors = JSON.parse(contributorFileContent) as Commit[];
          
          for (const contributor of contributors) {
            const email = contributor.commit.author.email.toLowerCase();
            repoCommitters.add(email);
          }
          console.log(`Found ${repoCommitters.size} unique committers for ${repo.name}`);
          
          // Get the full repo name with org if available
          const fullRepoName = repo.org ? `${repo.org}/${repo.name}` : repo.name;
          committersPerRepo.set(fullRepoName, repoCommitters);
        } catch (error) {
          console.error(`Error reading contributors for ${repo.name}:`, error);
        }
      }
    }

    // Write committers per repo to file
    await writeCommittersPerRepo(committersPerRepo);

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