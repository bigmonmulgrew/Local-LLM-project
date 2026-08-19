#!/usr/bin/env bash

#==========================================================
#
#
#  This script will automatically sync sample.env in the current directory with .env. 
#  Also supports multiple .env files starting with "sample.env"
#
#  ##!!##  Do not use this in production   ##!!## 
#  This script reqrites the target environment files directly.
#
#  - New variables from the sample.env but not in .env will be copied across.
#  - Changed variables in .env which are not empty will be preserved.
#  - Comments are preserved.
#  - Variables are sorted to match the sample.env ordering.
#  - Variables in .env that don't exist in sample.env are sorted to the end.
#  - Scrip outpuit highlights any new variables as well as any that don't exist in sample.env
#  - It will scan for and sync any files starting with sample.env
#
#  Examples:
#      sample.env          -> .env
#      sample.env.local    -> .env.local
#
#==========================================================

set -Eeuo pipefail
LC_ALL=C

readonly PREFIX="sample.env"
declare -a TEMP_FILES=()

cleanup() {
    if ((${#TEMP_FILES[@]})); then
        rm -f -- "${TEMP_FILES[@]}"
    fi
}

trap cleanup EXIT

canonical_key() {
    # Match the case-insensitive key lookup used by the original batch file.
    printf '%s' "${1,,}"
}

sync_env() {
    local sample_file=$1
    local target_file suffix temp_new line key value canonical existing_value
    local -A existing_values=()
    local -A sample_keys=()
    local -a added_keys=()
    local -a extra_lines=()
    local -a extra_keys=()

    if [[ $sample_file == "$PREFIX" ]]; then
        target_file=".env"
    else
        suffix=${sample_file#"$PREFIX"}
        target_file=".env${suffix}"
    fi

    printf '\n%s\n' '--------------------------------------------'
    printf 'Syncing %s from %s\n' "$target_file" "$sample_file"
    printf '%s\n' '--------------------------------------------'

    if [[ ! -e $target_file ]]; then
        printf '%s not found. Creating from %s...\n' "$target_file" "$sample_file"
        cp -- "$sample_file" "$target_file"
        printf '[OK] %s created successfully\n' "$target_file"
        return
    fi

    # Cache the current target values. As in the batch version, the last
    # occurrence of a duplicate key wins and an empty value is not preserved.
    while IFS= read -r line || [[ -n $line ]]; do
        line=${line%$'\r'}
        [[ -z $line || ${line:0:1} == '#' || $line != *'='* ]] && continue

        key=${line%%=*}
        value=${line#*=}
        [[ -z $key ]] && continue

        canonical=$(canonical_key "$key")
        existing_values["$canonical"]=$value
    done < "$target_file"

    temp_new=$(mktemp "${target_file}.new.XXXXXX")
    TEMP_FILES+=("$temp_new")

    # Rebuild the target in the same order as the sample file.
    while IFS= read -r line || [[ -n $line ]]; do
        line=${line%$'\r'}

        if [[ -z $line || ${line:0:1} == '#' ]]; then
            printf '%s\n' "$line" >> "$temp_new"
            continue
        fi

        # Preserve unrecognized non-variable lines instead of turning them
        # into malformed KEY= entries.
        if [[ $line != *'='* ]]; then
            printf '%s\n' "$line" >> "$temp_new"
            continue
        fi

        key=${line%%=*}
        value=${line#*=}
        if [[ -z $key ]]; then
            printf '%s\n' "$line" >> "$temp_new"
            continue
        fi

        canonical=$(canonical_key "$key")
        sample_keys["$canonical"]=1
        existing_value=${existing_values["$canonical"]-}

        if [[ -n $existing_value ]]; then
            printf '%s=%s\n' "$key" "$existing_value" >> "$temp_new"
        else
            printf '%s=%s\n' "$key" "$value" >> "$temp_new"
            added_keys+=("$key")
        fi
    done < "$sample_file"

    # Keep target variables that are not present in the sample, retaining
    # their original order and complete value (including additional '=' signs).
    while IFS= read -r line || [[ -n $line ]]; do
        line=${line%$'\r'}
        [[ -z $line || ${line:0:1} == '#' || $line != *'='* ]] && continue

        key=${line%%=*}
        [[ -z $key ]] && continue
        canonical=$(canonical_key "$key")

        if [[ -z ${sample_keys["$canonical"]+present} ]]; then
            extra_lines+=("$line")
            extra_keys+=("$key")
        fi
    done < "$target_file"

    if ((${#extra_lines[@]})); then
        printf '\n# Extra variables kept from previous file\n' >> "$temp_new"
        printf 'Extra variables kept from previous file:\n'

        local i
        for i in "${!extra_lines[@]}"; do
            printf '%s\n' "${extra_lines[$i]}" >> "$temp_new"
            printf '  + %s\n' "${extra_keys[$i]}"
        done
    fi

    # Copy over the existing file so its permissions and any symlink target
    # are preserved, matching the behavior of the original script.
    cp -- "$temp_new" "$target_file"

    if ((${#added_keys[@]})); then
        printf '\nNew variables added to %s:\n' "$target_file"
        printf '  + %s\n' "${added_keys[@]}"
    fi

    printf '[OK] %s synced successfully\n' "$target_file"
}

main() {
    local -a candidates=("$PREFIX"*)
    local -a sample_files=()
    local file

    for file in "${candidates[@]}"; do
        [[ -f $file ]] && sample_files+=("$file")
    done

    printf '%s\n' '============================================'
    printf '%s\n' '  Environment Variable Updater (Multi-env)'
    printf '%s\n' '============================================'
    printf '\nFound files matching "%s*":\n' "$PREFIX"
    printf '%s\n' '--------------------------------------------'

    if ((${#sample_files[@]} == 0)); then
        printf 'ERROR: No files found.\n' >&2
        return 1
    fi

    printf '  - %s\n' "${sample_files[@]}"
    printf '%s\n' '--------------------------------------------'

    for file in "${sample_files[@]}"; do
        sync_env "$file"
    done

    printf '\n%s\n' '============================================'
    printf '%s\n' '[OK] All environment files processed'
    printf '%s\n' '============================================'

    read -n 1 -s -r -p "Press any key to continue"
}



shopt -s nullglob
main "$@"