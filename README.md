# GitHub User Count

This script analyzes GitHub repositories to count unique contributors and categorize them based on their email domains.

## Features

- Fetches all repositories accessible to the provided GitHub token
- Analyzes commits from the last 90 days
- Categorizes contributors based on email domains
- Supports custom regex patterns for email categorization
- Interactive repository selection mode
- Caches repository and commit data for faster subsequent runs
- Generates detailed reports of contributors per repository

## Prerequisites

- Node.js
- A GitHub personal access token with appropriate permissions

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

## Usage

Basic usage:
```bash
node dist/index.js <token>
```

With custom domain:
```bash
node dist/index.js <token> https://your-github-domain.com
```

With force reload:
```bash
node dist/index.js <token> --force-reload
```

With interactive mode:
```bash
node dist/index.js <token> --interactive
```

With custom regex pattern:
```bash
node dist/index.js <token> --regex "gmail\.com$"
```

With regex pattern from file:
```bash
node dist/index.js <token> --regex-file patterns.txt
```

## Output Files

The script generates several output files:

1. `repositories.txt`: List of all repositories with their selection status
2. `repos/*-contributors.csv`: Individual CSV files for each repository containing commit data
3. `unique-contributors.txt`: List of unique contributors with non-matching email domains
4. `unique-contributors-others.txt`: List of unique contributors with matching email domains
5. `committers-per-repo.txt`: Detailed breakdown of committers for each repository

### committers-per-repo.txt Format

The `committers-per-repo.txt` file contains a hierarchical list of repositories and their committers:

```
repository-name
  committer1@example.com
  committer2@example.com

another-repository
  committer3@example.com
  committer1@example.com
```

Each repository is listed with its full name (including organization if available), followed by an indented list of all unique committers for that repository.

## Repository Selection

The script provides two ways to select repositories:

1. **Interactive Mode**: Use `--interactive` to be prompted for each repository
2. **Manual Selection**: 
   - Run the script once to generate `repositories.txt`
   - Edit the file to set `true` or `false` for each repository
   - Run the script again to process only selected repositories

## Email Categorization

The script categorizes contributors based on their email domains using a regex pattern. By default, it uses `/github\.com$/i` to identify GitHub-associated emails.

You can customize this using:
- `--regex` to specify a pattern directly
- `--regex-file` to read patterns from a file

## Notes

- The script caches repository and commit data to avoid unnecessary API calls
- Use `--force-reload` to refresh all data
- The script respects GitHub's rate limits and includes retry logic
- All timestamps are in UTC

## Example Output

```
Starting contributor analysis...
Organization: julian-veracode
GitHub Domain: https://api.github.com
Time period: Last 90 days

Using cached repositories from repositories.txt
Processing 5 selected repositories

Processing repository 1/5: repo1
Using cached commits for repo1

Processing repository 2/5: repo2
Using cached commits for repo2

...

Consolidating unique contributors...
Email: user1@example.com, Pattern: /gmail\.com$/i, Matches: false
Added to regular: user1@example.com
Email: user2@gmail.com, Pattern: /gmail\.com$/i, Matches: true
Added to others: user2@gmail.com

Analysis complete!
Total unique contributors: 45
Total unique GitHub contributors: 12
Results saved to unique-contributors.txt and unique-contributors-others.txt
```

## How It Works

1. **Repository Fetching**:
   - Fetches all repositories from the specified GitHub organization
   - Supports caching to avoid repeated API calls
   - Allows interactive selection of repositories to analyze

2. **Contributor Analysis**:
   - For each repository, fetches commits from the last 90 days
   - Extracts unique contributor email addresses
   - Categorizes contributors based on email domain patterns

3. **Data Processing**:
   - Converts all email addresses to lowercase for case-insensitive matching
   - Applies regex pattern to categorize contributors
   - Generates separate lists for different categories of contributors

4. **Output Generation**:
   - Creates detailed CSV files for each repository
   - Generates summary files with unique contributor counts
   - Provides both raw data and categorized results

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 