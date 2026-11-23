/** Activate a verified checkout only while its source inventory can be published. */
import {rename} from 'node:fs/promises'
import {join} from 'node:path'

export async function retainAndActivateSource({current,staged,backup,inventory,pendingInventory}){
  await rename(current,join(backup,'dsh'))
  let movedInventory=false,activated=false
  try{
    await rename(inventory,join(backup,'source-files.json'));movedInventory=true
    await rename(staged,current);activated=true
    await rename(pendingInventory,inventory)
  }catch(error){
    if(activated)await rename(current,staged)
    await rename(join(backup,'dsh'),current)
    if(movedInventory)await rename(join(backup,'source-files.json'),inventory)
    throw error
  }
}
