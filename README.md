# GitHub Contributor Counter

A Node.js tool to analyze and count unique contributors across GitHub repositories within an organization, with the ability to categorize contributors based on email domains.

## Features

- Fetches all repositories from a GitHub organization
- Analyzes commits from the last 90 days
- Counts unique contributors across all repositories
- Categorizes contributors based on email domain patterns (e.g., Gmail vs. corporate emails)
- Supports interactive repository selection
- Caches repository and contributor data for faster subsequent runs
- Case-insensitive email handling

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- GitHub Personal Access Token with appropriate permissions

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd github-contributor-counter
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your GitHub token:
```
GITHUB_TOKEN=your_github_token_here
```

4. Build the project:
```bash
ncc build src/index.ts
```

## Usage

Basic usage:
```bash
node dist/index.js <token> <organization>
```

### Options

- `--force-reload`: Force reload of repositories
- `--interactive`: Enable interactive repository selection
- `--regex <pattern>`: Use custom regex pattern for email categorization
- `--regex-file <file>`: Read regex pattern from file

### Examples

1. Basic usage:
```bash
node dist/index.js your-token julian-veracode
```

2. With interactive repository selection:
```bash
node dist/index.js your-token julian-veracode --interactive
```

3. With custom regex pattern:
```bash
node dist/index.js your-token julian-veracode --regex "/gmail\.com$/i"
```

## Output Files

The tool generates several output files:

1. `repositories.txt`: List of all repositories in the organization
2. `repos/*-contributors.csv`: Individual contributor data for each repository
3. `unique-contributors.txt`: List of unique contributors (excluding those matching the regex pattern)
4. `unique-contributors-others.txt`: List of unique contributors matching the regex pattern

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